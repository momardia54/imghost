import { useEffect, useState } from "react";
import { FolderNode, createFolder, deleteFolder, moveFile, renameFolder } from "../api";
import { confirmModal, promptModal } from "./Modal";
import { ChevronDownIcon, ChevronRightIcon, PencilIcon, PlusIcon, TrashIcon } from "../icons";

export type Selection = { type: "all" } | { type: "folder"; id: number };

interface Props {
  folders: FolderNode[];
  total: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onChanged: () => void;
  filter: string;
}

function buildChildren(folders: FolderNode[], parentId: number | null): FolderNode[] {
  return folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// With a filter active: folders whose name matches, plus their ancestors so the path stays visible.
function visibleIds(folders: FolderNode[], filter: string): Set<number> | null {
  const needle = filter.trim().toLowerCase();
  if (!needle) return null;
  const byId = new Map(folders.map((f) => [f.id, f]));
  const visible = new Set<number>();
  for (const f of folders) {
    if (!f.name.toLowerCase().includes(needle)) continue;
    let cur: FolderNode | undefined = f;
    while (cur && !visible.has(cur.id)) {
      visible.add(cur.id);
      cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id);
    }
  }
  return visible;
}

export default function FolderTree({ folders, total, selection, onSelect, onChanged, filter }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const visible = visibleIds(folders, filter);

  // Reveal the selected folder: expand its ancestors when the selection changes.
  const selectedId = selection.type === "folder" ? selection.id : null;
  useEffect(() => {
    if (selectedId === null) return;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const ancestors: number[] = [];
    let parent = byId.get(selectedId)?.parent_id ?? null;
    while (parent !== null && ancestors.length < 32) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleNewFolder() {
    const parentId = selection.type === "folder" ? selection.id : null;
    const name = await promptModal("Folder name:");
    if (!name) return;
    await createFolder(name, parentId);
    if (parentId !== null) setExpanded((prev) => new Set(prev).add(parentId));
    onChanged();
  }

  async function startRename(folder: FolderNode) {
    setRenamingId(folder.id);
    setRenameValue(folder.name);
  }

  async function commitRename(id: number) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name) return;
    await renameFolder(id, name);
    onChanged();
  }

  async function handleDeleteFolder(folder: FolderNode) {
    const ok = await confirmModal(`Delete "${folder.name}" and everything inside it?`);
    if (!ok) return;
    await deleteFolder(folder.id);
    if (selection.type === "folder" && selection.id === folder.id) {
      onSelect({ type: "all" });
    }
    onChanged();
  }

  async function handleDrop(e: React.DragEvent, folderId: number | null) {
    e.preventDefault();
    setDragOverId(null);
    const fileId = Number(e.dataTransfer.getData("text/x-imghost-file-id"));
    if (!fileId) return;
    await moveFile(fileId, folderId);
    onChanged();
  }

  function renderNode(folder: FolderNode, depth: number) {
    const children = buildChildren(folders, folder.id).filter((c) => !visible || visible.has(c.id));
    const isExpanded = visible ? children.length > 0 : expanded.has(folder.id);
    const isRenaming = renamingId === folder.id;
    const isActive = selection.type === "folder" && selection.id === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={
            "folder-row" +
            ` depth-${Math.min(depth, 20)}` +
            (isActive ? " active" : "") +
            (dragOverId === folder.id ? " drag-over" : "")
          }
          onClick={() => !isRenaming && onSelect({ type: "folder", id: folder.id })}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(folder.id);
          }}
          onDragLeave={() => setDragOverId((cur) => (cur === folder.id ? null : cur))}
          onDrop={(e) => handleDrop(e, folder.id)}
        >
          <span
            className={"caret" + (children.length === 0 ? " leaf" : "")}
            onClick={(e) => {
              e.stopPropagation();
              if (children.length > 0) toggle(folder.id);
            }}
          >
            {children.length > 0 && (isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />)}
          </span>
          {isRenaming ? (
            <input
              className="rename-input"
              type="text"
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => commitRename(folder.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(folder.id);
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <>
              <span className="folder-label" title={folder.name}>
                {folder.name}
              </span>
              <span className="row-end">
              <span className="folder-count">{folder.count}</span>
              <span className="row-actions">
                <button
                  className="icon-btn"
                  title="Rename"
                  aria-label={`Rename ${folder.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(folder);
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
                    handleDeleteFolder(folder);
                  }}
                >
                  <TrashIcon />
                </button>
              </span>
              </span>
            </>
          )}
        </div>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const rootFolders = buildChildren(folders, null).filter((f) => !visible || visible.has(f.id));

  return (
    <>
      <div className="sidebar-header">
        Folders
        <button className="icon-btn" title="New folder" aria-label="New folder" onClick={handleNewFolder}>
          <PlusIcon />
        </button>
      </div>
      <div id="folder-tree-scroll">
        <div id="folder-tree-inner">
        <div
          className={
            "folder-row" +
            (selection.type === "all" ? " active" : "") +
            (dragOverId === -1 ? " drag-over" : "")
          }
          onClick={() => onSelect({ type: "all" })}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverId(-1);
          }}
          onDragLeave={() => setDragOverId((cur) => (cur === -1 ? null : cur))}
          onDrop={(e) => handleDrop(e, null)}
        >
          <span className="caret leaf" />
          <span className="folder-label">All images</span>
          <span className="row-end">
            <span className="folder-count">{total}</span>
          </span>
        </div>
        {rootFolders.map((f) => renderNode(f, 1))}
        {visible && rootFolders.length === 0 && <div className="tree-empty">No matching folders</div>}
        </div>
      </div>
    </>
  );
}
