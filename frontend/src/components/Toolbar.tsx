import { useEffect, useRef } from "react";
import { FolderNode, SortOrder } from "../api";
import { Selection } from "../lib/actions";
import { folderPath } from "../lib/format";
import { ChevronRightIcon, GridIcon, ListIcon, MenuIcon, SearchIcon, UploadIcon, XIcon } from "../icons";
import { ViewMode } from "./Gallery";

export const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A–Z",
  size: "Largest first",
};

export function TopBar({
  folders,
  selection,
  searching,
  query,
  onQuery,
  onSelect,
  onMenu,
  onUpload,
}: {
  folders: FolderNode[];
  selection: Selection;
  searching: boolean;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (sel: Selection) => void;
  onMenu: () => void;
  onUpload: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  // "/" or Cmd/Ctrl+K focuses search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        if (document.querySelector(".overlay, .lightbox")) return;
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const path = selection.type === "folder" ? folderPath(folders, selection.id) : [];

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" aria-label="Open sidebar" onClick={onMenu}>
        <MenuIcon />
      </button>
      <nav className="crumbs" aria-label="Breadcrumb">
        {searching ? (
          <span className="crumb current">Search</span>
        ) : (
          <>
            <button
              className={"crumb" + (selection.type !== "folder" ? " current" : "")}
              onClick={() => onSelect({ type: selection.type === "unsorted" ? "unsorted" : "all" })}
            >
              {selection.type === "unsorted" ? "Unsorted" : "Library"}
            </button>
            {path.map((f, i) => (
              <span className="crumb-wrap" key={f.id}>
                <ChevronRightIcon className="crumb-sep" />
                <button className={"crumb" + (i === path.length - 1 ? " current" : "")} onClick={() => onSelect({ type: "folder", id: f.id })}>
                  {f.name}
                </button>
              </span>
            ))}
          </>
        )}
      </nav>
      <div className="search">
        <SearchIcon />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search images and folders"
          aria-label="Search images and folders"
          value={query}
          maxLength={100}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onQuery("");
              inputRef.current?.blur();
            }
          }}
        />
        {query ? (
          <button className="icon-btn search-clear" aria-label="Clear search" onClick={() => onQuery("")}>
            <XIcon />
          </button>
        ) : (
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        )}
      </div>
      <button className="primary upload-btn" onClick={onUpload}>
        <UploadIcon />
        <span>Upload</span>
      </button>
    </header>
  );
}

export function PageHead({
  title,
  subtitle,
  sort,
  view,
  tileSize,
  onSort,
  onView,
  onTileSize,
}: {
  title: string;
  subtitle: string;
  sort: SortOrder;
  view: ViewMode;
  tileSize: number;
  onSort: (s: SortOrder) => void;
  onView: (v: ViewMode) => void;
  onTileSize: (n: number) => void;
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="view-controls">
        {view === "grid" && (
          <input
            className="zoom"
            type="range"
            min={120}
            max={320}
            step={20}
            value={tileSize}
            aria-label="Thumbnail size"
            title="Thumbnail size"
            onChange={(e) => onTileSize(Number(e.target.value))}
          />
        )}
        <select className="sort" aria-label="Sort" value={sort} onChange={(e) => onSort(e.target.value as SortOrder)}>
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="segmented icons" role="radiogroup" aria-label="View">
          <button role="radio" aria-checked={view === "grid"} className={view === "grid" ? "on" : ""} title="Grid" onClick={() => onView("grid")}>
            <GridIcon />
          </button>
          <button role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} title="List" onClick={() => onView("list")}>
            <ListIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
