import { ReactNode, useEffect, useState } from "react";
import { FolderNode, createFolder, deleteFolder, renameFolder } from "../api";
import { Selection, isInternalDrag, moveFiles, readDraggedIds } from "../lib/actions";
import { childFolders, pluralize } from "../lib/format";
import { confirmModal, promptModal } from "./Modal";
import { toast, toastError } from "./Toast";
import { ChevronRightIcon, FolderIcon, FolderPlusIcon, ImagesIcon, InboxIcon, PencilIcon, PlusIcon, TrashIcon } from "../icons";

interface Props {
  folders: FolderNode[];
  total: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onChanged: () => void;
}

export async function newFolder(parentId: number | null, onCreated: (f: FolderNode) => void): Promise<void> {
  const name = await promptModal({ title: parentId === null ? "New folder" : "New sub-folder", placeholder: "Folder name", confirmLabel: "Create" });
  if (!name) return;
  try {
    onCreated(await createFolder(name, parentId));
  } catch (err) {
    toastError(err, "Could not create folder");
  }
}

export default function FolderTree({ folders, total, selection, onSelect, onChanged }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // Reveal the selected folder: expand its ancestors when the selection changes.
  const selectedId = selection.type === "folder" ? selection.id : null;
  useEffect(() => {
    if (selectedId === null) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ancestors: number[] = [];
    let parent = byId.get(selectedId)?.parent_id ?? null;
    while (parent !== null && ancestors.length < 64) {
      ancestors.push(parent);
      parent = byId.get(parent)?.parent_id ?? null;
    }
    if (ancestors.length === 0) return;
    setExpanded((prev) => {
      if (ancestors.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ancestors.forEach((id) => next.add(id));
      return next;
    });
  }, [selectedId, folders]);

  const unsortedCount = total - childFolders(folders, null).reduce((n, f) => n + f.count, 0);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function commitRename(folder: FolderNode) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === folder.name) return;
    try {
      await renameFolder(folder.id, name);
      onChanged();
    } catch (err) {
      toastError(err, "Could not rename folder");
    }
  }

  async function handleDelete(folder: FolderNode) {
    const sub = folders.filter((f) => f.parent_id === folder.id).length;
    const parts = [folder.count > 0 ? pluralize(folder.count, "image") : "", sub > 0 ? pluralize(sub, "sub-folder") : ""].filter(Boolean);
    const ok = await confirmModal({
      title: `Delete "${folder.name}"?`,
      message: parts.length
        ? `This permanently deletes ${parts.join(" and ")} inside it. Public links to those images will stop working.`
        : "This folder is empty.",
      confirmLabel: "Delete folder",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFolder(folder.id);
      toast(`Deleted "${folder.name}"`);
      if (selection.type === "folder" && selection.id === folder.id) {
        onSelect(folder.parent_id === null ? { type: "all" } : { type: "folder", id: folder.parent_id });
      }
      onChanged();
    } catch (err) {
      toastError(err, "Could not delete folder");
    }
  }

  // Each row is a drop target for images dragged from the gallery.
  function dropProps(key: string, folderId: number | null, name: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!isInternalDrag(e)) return;
        e.preventDefault();
        setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((cur) => (cur === key ? null : cur)),
      onDrop: async (e: React.DragEvent) => {
        if (!isInternalDrag(e)) return;
        e.preventDefault();
        setDropTarget(null);
        await moveFiles(readDraggedIds(e), folderId, name);
        onChanged();
      },
    };
  }

  function navRow(key: string, sel: Selection, icon: ReactNode, label: string, count: number, drop?: ReturnType<typeof dropProps>) {
    const active = selection.type === sel.type && (sel.type !== "folder" || (selection.type === "folder" && selection.id === sel.id));
    return (
      <div
        className={"tree-row nav" + (active ? " active" : "") + (dropTarget === key ? " drop" : "")}
        onClick={() => onSelect(sel)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onSelect(sel)}
        {...drop}
      >
        <span className="tree-icon">{icon}</span>
        <span className="tree-label">{label}</span>
        <span className="tree-count">{count}</span>
      </div>
    );
  }

  function renderNode(folder: FolderNode, depth: number): ReactNode {
    const children = childFolders(folders, folder.id);
    const isExpanded = expanded.has(folder.id);
    const isActive = selection.type === "folder" && selection.id === folder.id;
    const key = `f${folder.id}`;

    return (
      <div key={folder.id} role="treeitem" aria-expanded={children.length ? isExpanded : undefined}>
        <div
          className={`tree-row depth-${Math.min(depth, 12)}` + (isActive ? " active" : "") + (dropTarget === key ? " drop" : "")}
          onClick={() => renamingId !== folder.id && onSelect({ type: "folder", id: folder.id })}
          onDoubleClick={() => {
            setRenamingId(folder.id);
            setRenameValue(folder.name);
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter") onSelect({ type: "folder", id: folder.id });
            if (e.key === "ArrowRight" && children.length) setExpanded((p) => new Set(p).add(folder.id));
            if (e.key === "ArrowLeft" && isExpanded) toggle(folder.id);
            if (e.key === "F2") {
              setRenamingId(folder.id);
              setRenameValue(folder.name);
            }
          }}
          {...dropProps(key, folder.id, folder.name)}
        >
          <button
            className={"tree-caret" + (children.length === 0 ? " leaf" : "") + (isExpanded ? " open" : "")}
            tabIndex={-1}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              if (children.length) toggle(folder.id);
            }}
          >
            <ChevronRightIcon />
          </button>
          <span className="tree-icon">
            <FolderIcon />
          </span>
          {renamingId === folder.id ? (
            <input
              className="tree-rename"
              autoFocus
              maxLength={100}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => commitRename(folder)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(folder);
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <>
              <span className="tree-label" title={folder.name}>
                {folder.name}
              </span>
              <span className="tree-count">{folder.count}</span>
              <span className="tree-actions">
                <button
                  className="icon-btn"
                  title="New sub-folder"
                  aria-label={`New folder in ${folder.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    newFolder(folder.id, (f) => {
                      setExpanded((p) => new Set(p).add(folder.id));
                      onChanged();
                      onSelect({ type: "folder", id: f.id });
                    });
                  }}
                >
                  <PlusIcon />
                </button>
                <button
                  className="icon-btn"
                  title="Rename"
                  aria-label={`Rename ${folder.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenamingId(folder.id);
                    setRenameValue(folder.name);
                  }}
                >
                  <PencilIcon />
                </button>
                <button
                  className="icon-btn danger-hover"
                  title="Delete"
                  aria-label={`Delete ${folder.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(folder);
                  }}
                >
                  <TrashIcon />
                </button>
              </span>
            </>
          )}
        </div>
        {isExpanded && children.length > 0 && <div role="group">{children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  }

  const roots = childFolders(folders, null);

  return (
    <nav className="tree" aria-label="Library">
      <div className="tree-section">
        {navRow("all", { type: "all" }, <ImagesIcon />, "All images", total)}
        {navRow("unsorted", { type: "unsorted" }, <InboxIcon />, "Unsorted", unsortedCount, dropProps("unsorted", null, "Unsorted"))}
      </div>
      <div className="tree-heading">
        <span>Folders</span>
        <button
          className="icon-btn"
          title="New folder"
          aria-label="New folder"
          onClick={() =>
            newFolder(null, (f) => {
              onChanged();
              onSelect({ type: "folder", id: f.id });
            })
          }
        >
          <FolderPlusIcon />
        </button>
      </div>
      <div className="tree-scroll" role="tree">
        <div className="tree-inner">
          {roots.map((f) => renderNode(f, 0))}
          {roots.length === 0 && <div className="tree-empty">No folders yet</div>}
        </div>
      </div>
    </nav>
  );
}
