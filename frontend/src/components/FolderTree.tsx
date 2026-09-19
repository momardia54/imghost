import { useState } from "react";
import { FolderNode, createFolder, deleteFolder, moveFile, renameFolder } from "../api";
import { confirmModal, promptModal } from "./Modal";
import {
  ChevronLeftSmallIcon,
  ChevronRightSmallIcon,
  FolderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "../icons";

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

// The sidebar shows one level at a time (drill-down), so nesting depth never costs width.
// What it shows follows the selection: a folder with sub-folders lists those, a leaf folder
// lists its siblings (with itself highlighted), and "All images" lists the top level.
export default function FolderTree({ folders, total, selection, onSelect, onChanged, filter }: Props) {
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const byId = new Map(folders.map((f) => [f.id, f]));
  const selected = selection.type === "folder" ? byId.get(selection.id) : undefined;
  const hasChildren = (id: number) => folders.some((f) => f.parent_id === id);
  const browseId: number | null = selected ? (hasChildren(selected.id) ? selected.id : selected.parent_id) : null;
  const browseFolder = browseId !== null ? byId.get(browseId) : undefined;
  const rows = buildChildren(folders, browseId);

  const needle = filter.trim().toLowerCase();
  const matches = needle
    ? folders.filter((f) => f.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  function parentPath(f: FolderNode): string {
    const names: string[] = [];
    let cur = f.parent_id === null ? undefined : byId.get(f.parent_id);
    while (cur && names.length < 32) {
      names.unshift(cur.name);
      cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id);
    }
    return names.join(" / ");
  }

  function isSelfOrDescendantOf(id: number, ancestorId: number): boolean {
    let cur: FolderNode | undefined = byId.get(id);
    let guard = 0;
    while (cur && guard++ < 64) {
      if (cur.id === ancestorId) return true;
      cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id);
    }
    return false;
  }

  function goTo(folderId: number | null) {
    onSelect(folderId === null ? { type: "all" } : { type: "folder", id: folderId });
  }

  async function handleNewFolder() {
    const parentId = selection.type === "folder" ? selection.id : null;
    const name = await promptModal("Folder name:");
    if (!name) return;
    await createFolder(name, parentId);
    onChanged();
  }

  function startRename(folder: FolderNode) {
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
    const selectionGone = selection.type === "folder" && isSelfOrDescendantOf(selection.id, folder.id);
    await deleteFolder(folder.id);
    if (selectionGone) goTo(folder.parent_id);
    onChanged();
  }

  async function handleDrop(e: React.DragEvent, folderId: number | null, key: number) {
    e.preventDefault();
    setDragOverId((cur) => (cur === key ? null : cur));
    const fileId = Number(e.dataTransfer.getData("text/x-imghost-file-id"));
    if (!fileId) return;
    await moveFile(fileId, folderId);
    onChanged();
  }

  function dropProps(folderId: number | null, key: number) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverId(key);
      },
      onDragLeave: () => setDragOverId((cur) => (cur === key ? null : cur)),
      onDrop: (e: React.DragEvent) => handleDrop(e, folderId, key),
    };
  }

  function renderFolderRow(folder: FolderNode, opts: { current?: boolean; showPath?: boolean } = {}) {
    const isRenaming = renamingId === folder.id;
    const isActive = selection.type === "folder" && selection.id === folder.id;
    const drills = hasChildren(folder.id) && !opts.current;
    const path = opts.showPath ? parentPath(folder) : "";

    return (
      <div
        key={folder.id}
        className={
          "folder-row" +
          (opts.current ? " current" : "") +
          (isActive ? " active" : "") +
          (dragOverId === folder.id ? " drag-over" : "")
        }
        title={path ? `${path} / ${folder.name}` : folder.name}
        onClick={() => !isRenaming && goTo(folder.id)}
        {...dropProps(folder.id, folder.id)}
      >
        <FolderIcon className="row-icon" />
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
            <span className="folder-text">
              <span className="folder-label">{folder.name}</span>
              {path && <span className="folder-path">{path}</span>}
            </span>
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
            {drills && <ChevronRightSmallIcon className="drill" />}
          </>
        )}
      </div>
    );
  }

  const parentOfBrowse = browseFolder ? (browseFolder.parent_id !== null ? byId.get(browseFolder.parent_id) : undefined) : undefined;

  return (
    <>
      <div className="sidebar-header">
        Folders
        <button className="icon-btn" title="New folder" aria-label="New folder" onClick={handleNewFolder}>
          <PlusIcon />
        </button>
      </div>
      <div id="folder-tree-scroll">
        {needle ? (
          <>
            {matches.map((f) => renderFolderRow(f, { showPath: true }))}
            {matches.length === 0 && <div className="tree-empty">No matching folders</div>}
          </>
        ) : (
          <>
            <div
              className={
                "folder-row" +
                (selection.type === "all" ? " active" : "") +
                (dragOverId === -1 ? " drag-over" : "")
              }
              onClick={() => goTo(null)}
              {...dropProps(null, -1)}
            >
              <span className="row-icon" />
              <span className="folder-text">
                <span className="folder-label">All images</span>
              </span>
              <span className="folder-count">{total}</span>
            </div>
            {browseFolder && (
              <>
                <div
                  className={"folder-row back" + (dragOverId === -2 ? " drag-over" : "")}
                  title="Up one level"
                  onClick={() => goTo(browseFolder.parent_id)}
                  {...dropProps(browseFolder.parent_id, -2)}
                >
                  <ChevronLeftSmallIcon className="row-icon" />
                  <span className="folder-text">
                    <span className="folder-label">{parentOfBrowse ? parentOfBrowse.name : "All folders"}</span>
                  </span>
                </div>
                {renderFolderRow(browseFolder, { current: true })}
              </>
            )}
            <div className={browseFolder ? "folder-children" : undefined}>{rows.map((f) => renderFolderRow(f))}</div>
            {rows.length === 0 && !browseFolder && <div className="tree-empty">No folders yet</div>}
          </>
        )}
      </div>
    </>
  );
}
