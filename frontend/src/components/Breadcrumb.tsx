import { FolderNode } from "../api";
import { Selection } from "./FolderTree";

function pathTo(folders: FolderNode[], id: number): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  let current = byId.get(id);
  while (current) {
    path.unshift(current);
    current = current.parent_id !== null ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

export default function Breadcrumb({
  folders,
  selection,
  onSelect,
}: {
  folders: FolderNode[];
  selection: Selection;
  onSelect: (sel: Selection) => void;
}) {
  const path = selection.type === "folder" ? pathTo(folders, selection.id) : [];

  return (
    <div className="breadcrumb">
      <span onClick={() => onSelect({ type: "all" })} className={selection.type === "all" ? "current" : "crumb-link"}>
        All images
      </span>
      {path.map((folder, i) => (
        <span key={folder.id}>
          <span className="sep">/</span>
          <span
            className={i === path.length - 1 ? "current" : "crumb-link"}
            onClick={() => onSelect({ type: "folder", id: folder.id })}
          >
            {folder.name}
          </span>
        </span>
      ))}
    </div>
  );
}
