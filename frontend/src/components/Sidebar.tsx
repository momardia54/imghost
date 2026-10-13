import { FolderNode } from "../api";
import { Selection } from "../lib/actions";
import { formatBytes } from "../lib/format";
import { KeyIcon, LogOutIcon, LogoMark } from "../icons";
import FolderTree from "./FolderTree";
import ThemeToggle from "./ThemeToggle";

// R2's free tier includes 10 GB-month of storage.
const FREE_TIER_BYTES = 10 * 1024 ** 3;

export default function Sidebar({
  open,
  folders,
  total,
  bytes,
  selection,
  onSelect,
  onChanged,
  onApiKeys,
  onLogout,
}: {
  open: boolean;
  folders: FolderNode[];
  total: number;
  bytes: number;
  selection: Selection;
  onSelect: (sel: Selection) => void;
  onChanged: () => void;
  onApiKeys: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className={"sidebar" + (open ? " open" : "")}>
      <div className="brand">
        <LogoMark />
        <span className="brand-name">imghost</span>
        <span className="brand-version">v{__APP_VERSION__}</span>
      </div>

      <FolderTree folders={folders} total={total} selection={selection} onSelect={onSelect} onChanged={onChanged} />

      <div className="sidebar-bottom">
        <div className="storage" title="Cloudflare R2 free tier: 10 GB of storage">
          <div className="storage-row">
            <span>Storage</span>
            <span className="storage-value">
              {formatBytes(bytes)} <span className="muted">/ 10 GB</span>
            </span>
          </div>
          <progress className="storage-bar" value={Math.min(bytes, FREE_TIER_BYTES)} max={FREE_TIER_BYTES} />
        </div>
        <div className="sidebar-actions">
          <button className="sidebar-btn" onClick={onApiKeys}>
            <KeyIcon />
            API keys
          </button>
          <ThemeToggle />
          <button className="icon-btn" title="Log out" aria-label="Log out" onClick={onLogout}>
            <LogOutIcon />
          </button>
        </div>
      </div>
    </aside>
  );
}
