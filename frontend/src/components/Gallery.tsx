import { useEffect, useState } from "react";
import { FileItem, FolderNode, UnauthorizedError, deleteFile, listFiles } from "../api";
import { Selection } from "./FolderTree";
import { confirmModal } from "./Modal";
import { CheckIcon, ChevronLeftSmallIcon, ChevronRightSmallIcon, FolderIcon, ImageOffIcon, LinkIcon, TrashIcon } from "../icons";
import { copyToClipboard } from "../clipboard";

const PAGE_SIZE = 24;

export default function Gallery({
  selection,
  folders,
  refreshKey,
  onChanged,
  onSelect,
  onUnauthorized,
}: {
  selection: Selection;
  folders: FolderNode[];
  refreshKey: number;
  onChanged: () => void;
  onSelect: (sel: Selection) => void;
  onUnauthorized: () => void;
}) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const selectionKey = selection.type === "all" ? "all" : `folder-${selection.id}`;

  useEffect(() => {
    setPage(1);
  }, [selectionKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const opts =
      selection.type === "all"
        ? { folderId: null, scope: "all" as const, page, limit: PAGE_SIZE }
        : { folderId: selection.id, page, limit: PAGE_SIZE };

    listFiles(opts)
      .then((res) => {
        if (cancelled) return;
        setFiles(res.files);
        setTotal(res.total);
      })
      .catch((err) => {
        if (err instanceof UnauthorizedError) onUnauthorized();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, page, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const subfolders =
    selection.type === "folder"
      ? folders.filter((f) => f.parent_id === selection.id).sort((a, b) => a.name.localeCompare(b.name))
      : [];
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));

  async function handleCopy(file: FileItem) {
    const absoluteUrl = new URL(file.url, window.location.origin).href;
    const ok = await copyToClipboard(absoluteUrl);
    if (!ok) return;
    setCopiedId(file.id);
    setTimeout(() => setCopiedId((cur) => (cur === file.id ? null : cur)), 1500);
  }

  async function handleDelete(file: FileItem) {
    const ok = await confirmModal(`Delete "${file.original_name}"?`);
    if (!ok) return;
    await deleteFile(file.id);
    onChanged();
  }

  if (loading && files.length === 0) {
    return <div className="empty-state">Loading…</div>;
  }

  const subfolderGrid = subfolders.length > 0 && (
    <div className="subfolder-grid">
      {subfolders.map((f) => (
        <button className="subfolder-card" key={f.id} onClick={() => onSelect({ type: "folder", id: f.id })}>
          <FolderIcon />
          <span className="name" title={f.name}>
            {f.name}
          </span>
          <span className="folder-count">{f.count}</span>
        </button>
      ))}
    </div>
  );

  if (files.length === 0) {
    return (
      <>
        {subfolderGrid}
        <div className="empty-state">
          <ImageOffIcon />
          No images in this folder yet.
        </div>
      </>
    );
  }

  return (
    <>
      {subfolderGrid}
      <div className="image-grid">
        {files.map((file) => (
          <div
            className="image-card"
            key={file.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/x-imghost-file-id", String(file.id));
            }}
          >
            <div className="thumb">
              <img src={`${file.url}?size=small`} alt={file.original_name} loading="lazy" />
              <div className="thumb-overlay">
                <button
                  className={copiedId === file.id ? "copied" : ""}
                  title="Copy link"
                  aria-label="Copy link"
                  onClick={() => handleCopy(file)}
                >
                  {copiedId === file.id ? <CheckIcon /> : <LinkIcon />}
                </button>
                <button className="del" title="Delete" aria-label="Delete" onClick={() => handleDelete(file)}>
                  <TrashIcon />
                </button>
              </div>
            </div>
            <div className="info">
              <div className="name" title={file.original_name}>
                {file.original_name}
              </div>
              {selection.type === "all" && file.folder_id !== null && (
                <span className="folder-tag">{folderNameById.get(file.folder_id) ?? "folder"}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeftSmallIcon />
            Prev
          </button>
          <span className="page-info">
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
            <ChevronRightSmallIcon />
          </button>
        </div>
      )}
    </>
  );
}
