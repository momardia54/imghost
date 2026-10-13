import { FolderInputIcon, LinkIcon, TrashIcon, XIcon } from "../icons";

export default function SelectionBar({
  count,
  allSelected,
  onSelectAll,
  onClear,
  onCopy,
  onMove,
  onDelete,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="selection-bar" role="toolbar" aria-label="Selected images">
      <button className="icon-btn" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}>
        <XIcon />
      </button>
      <span className="selection-count">{count} selected</span>
      {!allSelected && (
        <button className="link-btn" onClick={onSelectAll}>
          Select all
        </button>
      )}
      <span className="selection-divider" />
      <button className="bar-btn" onClick={onCopy}>
        <LinkIcon />
        <span>Copy links</span>
      </button>
      <button className="bar-btn" onClick={onMove}>
        <FolderInputIcon />
        <span>Move</span>
      </button>
      <button className="bar-btn danger" onClick={onDelete}>
        <TrashIcon />
        <span>Delete</span>
      </button>
    </div>
  );
}
