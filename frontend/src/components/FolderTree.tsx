import { useState } from "react";
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
}

function buildChildren(folders: FolderNode[], parentId: number | null): FolderNode[] {
  return folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export default function FolderTree({ folders, total, selection, onSelect, onChanged }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverId, setDragOverId] = useState<number | null>(null);

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
    const children = buildChildren(folders, folder.id);
    const isExpanded = expanded.has(folder.id);
    const isRenaming = renamingId === folder.id;
    const isActive = selection.type === "folder" && selection.id === folder.id;

    return (
      <div key={folder.id}>
        <div
          className={
            "folder-row" +
            ` depth-${Math.min(depth, 8)}` +
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
              <span className="folder-label">{folder.name}</span>
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
            </>
          )}
        </div>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  }

  const rootFolders = buildChildren(folders, null);

  return (
    <>
      <div className="sidebar-header">
        Folders
        <button className="icon-btn" title="New folder" aria-label="New folder" onClick={handleNewFolder}>
          <PlusIcon />
        </button>
      </div>
      <div id="folder-tree-scroll">
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
          <span className="folder-count">{total}</span>
        </div>
        {rootFolders.map((f) => renderNode(f, 1))}
      </div>
    </>
  );
}
