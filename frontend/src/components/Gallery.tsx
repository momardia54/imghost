import { useEffect, useMemo, useRef, useState } from "react";
import { FileItem, FolderNode, SortOrder, UnauthorizedError, listFiles } from "../api";
import { copyToClipboard } from "../clipboard";
import { Selection, deleteFiles, isInternalDrag, moveFiles, readDraggedIds, setDraggedIds } from "../lib/actions";
import { absoluteUrl, childFolders, folderPath, formatBytes, formatDate, formatType, pluralize } from "../lib/format";
import { CheckIcon, FolderIcon, ImagesIcon, LinkIcon, SearchIcon, UploadIcon } from "../icons";
import Lightbox from "./Lightbox";
import { confirmModal } from "./Modal";
import MoveDialog from "./MoveDialog";
import SelectionBar from "./SelectionBar";
import { toast, toastError } from "./Toast";

export type ViewMode = "grid" | "list";

const PAGE_SIZE = 60;

interface Props {
  selection: Selection;
  folders: FolderNode[];
  query: string;
  sort: SortOrder;
  view: ViewMode;
  tileSize: number;
  refreshKey: number;
  libraryTotal: number;
  onTreeChanged: () => void;
  onSelect: (sel: Selection) => void;
  onUnauthorized: () => void;
  onPickFiles: () => void;
  onTotal: (n: number | null) => void;
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export default function Gallery(props: Props) {
  const { selection, folders, query, sort, view, tileSize, refreshKey, onTreeChanged, onSelect, onUnauthorized } = props;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pageState, setPageState] = useState({ key: "", offset: 0 });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [moving, setMoving] = useState<number[] | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [dropFolder, setDropFolder] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const locationKey = query ? `q:${query}` : selection.type === "folder" ? `f:${selection.id}` : selection.type;
  // A new location, sort or refresh starts over from the first page.
  const listKey = `${locationKey}|${sort}|${refreshKey}`;
  const offset = pageState.key === listKey ? pageState.offset : 0;
  const nextPage = () => setPageState({ key: listKey, offset: files.length });

  useEffect(() => {
    setFiles([]);
    setSelected(new Set());
    setAnchor(null);
  }, [locationKey, sort]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const base = { sort, offset, limit: PAGE_SIZE };
    const opts = query
      ? { ...base, folderId: null, q: query }
      : selection.type === "all"
        ? { ...base, folderId: null, scope: "all" as const }
        : { ...base, folderId: selection.type === "folder" ? selection.id : null };

    listFiles(opts)
      .then((res) => {
        if (cancelled) return;
        setFiles((prev) => (offset === 0 ? res.files : [...prev, ...res.files.filter((f) => !prev.some((p) => p.id === f.id))]));
        setTotal(res.total);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) onUnauthorized();
        else if (!cancelled) toastError(err, "Could not load images");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, offset]);

  useEffect(() => {
    props.onTotal(loading && offset === 0 ? null : total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, loading, offset]);

  // Infinite scroll: load the next page when the sentinel comes into view.
  const hasMore = files.length < total;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) nextPage();
    }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, files.length]);

  // Tile size lives in a CSS variable; set through CSSOM because the CSP forbids style attributes.
  useEffect(() => {
    gridRef.current?.style.setProperty("--tile", `${tileSize}px`);
  });

  // Keep the lightbox in range when the image it shows leaves the list (moved elsewhere, deleted).
  useEffect(() => {
    if (openIndex !== null && openIndex >= files.length) setOpenIndex(files.length ? files.length - 1 : null);
  }, [files.length, openIndex]);

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // Folder ids whose images belong in the current view (for local updates after a move).
  const viewFolders = useMemo(() => {
    if (selection.type !== "folder" || query) return null;
    const ids = new Set<number>([selection.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of folders) if (f.parent_id !== null && ids.has(f.parent_id) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
    }
    return ids;
  }, [folders, selection, query]);

  function removeLocal(ids: number[]) {
    const gone = new Set(ids);
    setFiles((prev) => prev.filter((f) => !gone.has(f.id)));
    setTotal((t) => Math.max(0, t - ids.length));
    setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
  }

  async function doMove(ids: number[], folderId: number | null) {
    const name = folderId === null ? "Unsorted" : folderById.get(folderId)?.name ?? "folder";
    if (!(await moveFiles(ids, folderId, name))) return;
    const staysVisible =
      query || selection.type === "all" ? true : selection.type === "unsorted" ? folderId === null : folderId !== null && !!viewFolders?.has(folderId);
    if (staysVisible) {
      const moved = new Set(ids);
      setFiles((prev) => prev.map((f) => (moved.has(f.id) ? { ...f, folder_id: folderId } : f)));
      setSelected(new Set());
    } else {
      removeLocal(ids);
    }
    onTreeChanged();
  }

  async function doDelete(ids: number[]) {
    if (ids.length === 0) return;
    const one = ids.length === 1 ? files.find((f) => f.id === ids[0]) : undefined;
    const ok = await confirmModal({
      title: one ? `Delete "${one.original_name}"?` : `Delete ${ids.length} images?`,
      message: "This can't be undone. Public links to " + (one ? "this image" : "these images") + " will stop working.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return false;
    if (!(await deleteFiles(ids))) return false;
    removeLocal(ids);
    onTreeChanged();
    return true;
  }

  async function copyLinks(ids: number[]) {
    const urls = files.filter((f) => ids.includes(f.id)).map((f) => absoluteUrl(f));
    if (await copyToClipboard(urls.join("\n"))) toast(urls.length === 1 ? "Link copied" : `${urls.length} links copied`);
  }

  async function copyOne(file: FileItem) {
    if (!(await copyToClipboard(absoluteUrl(file)))) return;
    setCopiedId(file.id);
    toast("Link copied");
    setTimeout(() => setCopiedId((cur) => (cur === file.id ? null : cur)), 1500);
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchor(id);
  }

  function selectRange(id: number) {
    const a = files.findIndex((f) => f.id === anchor);
    const b = files.findIndex((f) => f.id === id);
    if (a < 0 || b < 0) return toggle(id);
    const [from, to] = a < b ? [a, b] : [b, a];
    setSelected((prev) => new Set([...prev, ...files.slice(from, to + 1).map((f) => f.id)]));
  }

  function handleTileClick(e: React.MouseEvent, file: FileItem, index: number) {
    if (e.shiftKey && anchor !== null) return selectRange(file.id);
    if (e.metaKey || e.ctrlKey || selected.size > 0) return toggle(file.id);
    setOpenIndex(index);
  }

  // Gallery keyboard shortcuts (inactive while a dialog or the lightbox is open).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTyping(e) || openIndex !== null || moving || document.querySelector(".overlay")) return;
      if (e.key === "Escape" && selected.size) setSelected(new Set());
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && files.length) {
        e.preventDefault();
        setSelected(new Set(files.map((f) => f.id)));
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
        e.preventDefault();
        doDelete([...selected]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const needle = query.toLowerCase();
  const subfolders = query
    ? folders.filter((f) => f.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
    : selection.type === "folder"
      ? childFolders(folders, selection.id)
      : [];

  const showFolderTag = !!query || selection.type === "all";
  const currentName = selection.type === "folder" ? folderById.get(selection.id)?.name ?? "this folder" : "";

  const folderCards = subfolders.length > 0 && (
    <section className="folder-cards" aria-label="Folders">
      {subfolders.map((f) => {
        const path = query ? folderPath(folders, f.id).slice(0, -1).map((p) => p.name).join(" / ") : "";
        const subCount = folders.filter((x) => x.parent_id === f.id).length;
        return (
          <button
            key={f.id}
            className={"folder-card" + (dropFolder === f.id ? " drop" : "")}
            onClick={() => onSelect({ type: "folder", id: f.id })}
            title={path ? `${path} / ${f.name}` : f.name}
            onDragOver={(e) => {
              if (!isInternalDrag(e)) return;
              e.preventDefault();
              setDropFolder(f.id);
            }}
            onDragLeave={() => setDropFolder((cur) => (cur === f.id ? null : cur))}
            onDrop={(e) => {
              if (!isInternalDrag(e)) return;
              e.preventDefault();
              setDropFolder(null);
              doMove(readDraggedIds(e), f.id);
            }}
          >
            <span className="folder-card-icon">
              <FolderIcon />
            </span>
            <span className="folder-card-text">
              <span className="folder-card-name">{f.name}</span>
              <span className="folder-card-meta">
                {path || [pluralize(f.count, "image"), subCount ? pluralize(subCount, "folder") : ""].filter(Boolean).join(" · ")}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );

  if (loading && offset === 0 && files.length === 0) {
    return (
      <div className={view === "grid" ? "grid" : "list"} ref={gridRef} aria-busy="true">
        {Array.from({ length: view === "grid" ? 18 : 10 }, (_, i) => (
          <div key={i} className={view === "grid" ? "tile skeleton" : "row skeleton"} />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    const libraryEmpty = props.libraryTotal === 0 && !query;
    return (
      <>
        {folderCards}
        <div className="empty">
          <div className="empty-art">{query ? <SearchIcon /> : <ImagesIcon />}</div>
          <h2>{query ? "No matching images" : libraryEmpty ? "Your library is empty" : selection.type === "unsorted" ? "Nothing unsorted" : "This folder is empty"}</h2>
          <p>
            {query
              ? `No image names contain "${query}".`
              : selection.type === "unsorted"
                ? "Images that aren't in any folder show up here."
                : "Drop images anywhere on this page, paste them from your clipboard, or pick files."}
          </p>
          {!query && (
            <button className="primary" onClick={props.onPickFiles}>
              <UploadIcon />
              {selection.type === "folder" ? `Upload to ${currentName}` : "Upload images"}
            </button>
          )}
        </div>
      </>
    );
  }

  const selectedIds = [...selected];

  return (
    <>
      {folderCards}

      <div className={view === "grid" ? "grid" : "list"} ref={gridRef} role="list">
        {view === "list" && (
          <div className="row row-head" role="presentation">
            <span />
            <span />
            <span>Name</span>
            <span className="col-folder">Folder</span>
            <span className="col-type">Type</span>
            <span className="col-size">Size</span>
            <span className="col-date">Uploaded</span>
            <span />
          </div>
        )}
        {files.map((file, index) => {
          const isSelected = selected.has(file.id);
          const folderName = file.folder_id !== null ? folderById.get(file.folder_id)?.name : undefined;
          const common = {
            role: "listitem",
            draggable: true,
            onDragStart: (e: React.DragEvent) => setDraggedIds(e, isSelected ? selectedIds : [file.id]),
            onClick: (e: React.MouseEvent) => handleTileClick(e, file, index),
          };
          const check = (
            <button
              className={"check" + (isSelected ? " on" : "")}
              aria-label={isSelected ? "Deselect" : "Select"}
              aria-pressed={isSelected}
              onClick={(e) => {
                e.stopPropagation();
                if (e.shiftKey && anchor !== null) selectRange(file.id);
                else toggle(file.id);
              }}
            >
              <CheckIcon />
            </button>
          );
          const copyBtn = (
            <button
              className="icon-btn"
              title="Copy link"
              aria-label="Copy link"
              onClick={(e) => {
                e.stopPropagation();
                copyOne(file);
              }}
            >
              {copiedId === file.id ? <CheckIcon /> : <LinkIcon />}
            </button>
          );

          if (view === "list") {
            return (
              <div key={file.id} className={"row" + (isSelected ? " selected" : "")} {...common}>
                {check}
                <img className="row-thumb" src={`${file.url}?size=small`} alt="" loading="lazy" draggable={false} />
                <span className="row-name" title={file.original_name}>
                  {file.original_name}
                </span>
                <span className="col-folder muted">{folderName ?? "—"}</span>
                <span className="col-type muted">{formatType(file.content_type)}</span>
                <span className="col-size muted">{formatBytes(file.size)}</span>
                <span className="col-date muted">{formatDate(file.created_at)}</span>
                <span className="row-actions">{copyBtn}</span>
              </div>
            );
          }

          return (
            <div key={file.id} className={"tile" + (isSelected ? " selected" : "") + (selected.size ? " selecting" : "")} {...common}>
              <img src={`${file.url}?size=small`} alt={file.original_name} loading="lazy" draggable={false} />
              {check}
              <div className="tile-actions">{copyBtn}</div>
              <div className="tile-caption">
                <span className="tile-name" title={file.original_name}>
                  {file.original_name}
                </span>
                <span className="tile-meta">
                  {showFolderTag && folderName ? `${folderName} · ` : ""}
                  {formatBytes(file.size)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && <div ref={sentinelRef} className="sentinel">{loading && <span className="spinner" />}</div>}

      {selected.size > 0 && (
        <SelectionBar
          count={selected.size}
          allSelected={selected.size === files.length}
          onSelectAll={() => setSelected(new Set(files.map((f) => f.id)))}
          onClear={() => setSelected(new Set())}
          onCopy={() => copyLinks(selectedIds)}
          onMove={() => setMoving(selectedIds)}
          onDelete={() => doDelete(selectedIds)}
        />
      )}

      {moving && (
        <MoveDialog
          folders={folders}
          count={moving.length}
          onClose={() => setMoving(null)}
          onMove={async (folderId) => {
            const ids = moving;
            setMoving(null);
            await doMove(ids, folderId);
          }}
        />
      )}

      {openIndex !== null && files[openIndex] && (
        <Lightbox
          files={files}
          index={openIndex}
          folders={folders}
          onIndex={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          onMove={(file) => setMoving([file.id])}
          onDelete={async (file) => {
            const remaining = files.length - 1;
            if (await doDelete([file.id])) {
              if (remaining === 0) setOpenIndex(null);
              else setOpenIndex((i) => Math.min(i ?? 0, remaining - 1));
            }
          }}
        />
      )}
    </>
  );
}
