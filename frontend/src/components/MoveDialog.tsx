import { ReactNode, useState } from "react";
import { FolderNode } from "../api";
import { childFolders, folderPath } from "../lib/format";
import { FolderIcon, InboxIcon, SearchIcon } from "../icons";
import { Dialog } from "./Modal";

type Target = number | null | undefined; // undefined = nothing picked yet, null = Unsorted

export default function MoveDialog({
  folders,
  count,
  onClose,
  onMove,
}: {
  folders: FolderNode[];
  count: number;
  onClose: () => void;
  onMove: (folderId: number | null) => void;
}) {
  const [target, setTarget] = useState<Target>(undefined);
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();

  function option(id: number | null, icon: ReactNode, label: ReactNode, className = "") {
    return (
      <button
        key={id ?? "root"}
        className={`move-option ${className}` + (target === id ? " active" : "")}
        onClick={() => setTarget(id)}
        onDoubleClick={() => onMove(id)}
      >
        {icon}
        <span className="move-label">{label}</span>
      </button>
    );
  }

  function renderTree(parentId: number | null, depth: number): ReactNode[] {
    return childFolders(folders, parentId).flatMap((f) => [
      option(f.id, <FolderIcon />, f.name, `depth-${Math.min(depth, 12)}`),
      ...renderTree(f.id, depth + 1),
    ]);
  }

  const matches = needle
    ? folders
        .filter((f) => f.name.toLowerCase().includes(needle))
        .map((f) => ({ f, path: folderPath(folders, f.id).map((p) => p.name).join(" / ") }))
        .sort((a, b) => a.path.localeCompare(b.path))
    : [];

  return (
    <Dialog
      title={count === 1 ? "Move image" : `Move ${count} images`}
      onClose={onClose}
      className="dialog-move"
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={target === undefined} onClick={() => target !== undefined && onMove(target)}>
            Move here
          </button>
        </>
      }
    >
      <div className="field-search">
        <SearchIcon />
        <input autoFocus placeholder="Find a folder" value={filter} onChange={(e) => setFilter(e.target.value)} maxLength={100} />
      </div>
      <div className="move-list">
        {needle
          ? matches.length
            ? matches.map(({ f, path }) => option(f.id, <FolderIcon />, path))
            : [<div key="none" className="move-empty">No folders match "{filter}"</div>]
          : [option(null, <InboxIcon />, "Unsorted (no folder)"), ...renderTree(null, 0)]}
      </div>
    </Dialog>
  );
}
