import { useEffect, useState } from "react";
import { FileItem, FolderNode } from "../api";
import { copyToClipboard } from "../clipboard";
import { absoluteUrl, folderPath, formatBytes, formatDateTime, formatType } from "../lib/format";
import { readPref, writePref } from "../lib/prefs";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderInputIcon,
  InfoIcon,
  TrashIcon,
  XIcon,
} from "../icons";
import { toast } from "./Toast";

const FORMATS = ["url", "markdown", "html", "bbcode"] as const;
type Format = (typeof FORMATS)[number];
const FORMAT_LABELS: Record<Format, string> = { url: "Link", markdown: "Markdown", html: "HTML", bbcode: "BBCode" };

const SIZES = ["original", "large", "medium", "small", "thumb"] as const;
type Size = (typeof SIZES)[number];
const SIZE_LABELS: Record<Size, string> = {
  original: "Original",
  large: "Large · 1600px",
  medium: "Medium · 800px",
  small: "Small · 400px",
  thumb: "Thumb · 200px",
};

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function snippet(file: FileItem, format: Format, size: Size): string {
  const url = absoluteUrl(file, size === "original" ? undefined : size);
  const alt = file.original_name.replace(/\.[a-z0-9]+$/i, "");
  switch (format) {
    case "markdown":
      return `![${alt.replace(/[[\]]/g, "")}](${url})`;
    case "html":
      return `<img src="${url}" alt="${escapeHtml(alt)}">`;
    case "bbcode":
      return `[img]${url}[/img]`;
    default:
      return url;
  }
}

export default function Lightbox({
  files,
  index,
  folders,
  onIndex,
  onClose,
  onMove,
  onDelete,
}: {
  files: FileItem[];
  index: number;
  folders: FolderNode[];
  onIndex: (i: number) => void;
  onClose: () => void;
  onMove: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
}) {
  const file = files[index];
  const [loaded, setLoaded] = useState(false);
  const [showInfo, setShowInfo] = useState(() => readPref("lightbox-info", ["on", "off"], window.innerWidth > 900 ? "on" : "off") === "on");
  const [format, setFormat] = useState<Format>(() => readPref("share-format", FORMATS, "url"));
  const [size, setSize] = useState<Size>(() => readPref("share-size", SIZES, "original"));
  const [copied, setCopied] = useState(false);
  const isGif = file.content_type === "image/gif";
  const effectiveSize = isGif ? "original" : size;
  const code = snippet(file, format, effectiveSize);

  useEffect(() => setLoaded(false), [file.id]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector(".overlay")) return; // a dialog on top handles its own keys
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < files.length - 1) onIndex(index + 1);
      if (e.key === "i") toggleInfo();
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) copy();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Warm the neighbours so arrowing through feels instant.
  useEffect(() => {
    for (const n of [files[index - 1], files[index + 1]]) if (n) new Image().src = `${n.url}?size=large`;
  }, [index, files]);

  function toggleInfo() {
    setShowInfo((v) => {
      writePref("lightbox-info", v ? "off" : "on");
      return !v;
    });
  }

  async function copy() {
    if (!(await copyToClipboard(code))) return;
    setCopied(true);
    toast(`${FORMAT_LABELS[format]} copied`);
    setTimeout(() => setCopied(false), 1500);
  }

  const folderLabel =
    file.folder_id === null
      ? "Unsorted"
      : folderPath(folders, file.folder_id)
          .map((f) => f.name)
          .join(" / ") || "—";

  return (
    <div className={"lightbox" + (showInfo ? " with-info" : "")} role="dialog" aria-modal="true" aria-label={file.original_name}>
      <header className="lightbox-bar">
        <div className="lightbox-title">
          <span className="lightbox-name">{file.original_name}</span>
          <span className="lightbox-counter">
            {index + 1} / {files.length}
          </span>
        </div>
        <div className="lightbox-tools">
          <a className="icon-btn" href={file.url} target="_blank" rel="noreferrer" title="Open original" aria-label="Open original">
            <ExternalLinkIcon />
          </a>
          <a className="icon-btn" href={file.url} download={file.original_name} title="Download" aria-label="Download">
            <DownloadIcon />
          </a>
          <button className={"icon-btn" + (showInfo ? " on" : "")} title="Details (i)" aria-label="Toggle details" onClick={toggleInfo}>
            <InfoIcon />
          </button>
          <button className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <XIcon />
          </button>
        </div>
      </header>

      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {!loaded && <span className="spinner" />}
        <img
          key={file.id}
          className={loaded ? "loaded" : ""}
          src={`${file.url}?size=large`}
          alt={file.original_name}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
        {index > 0 && (
          <button className="lightbox-nav prev" aria-label="Previous image" onClick={() => onIndex(index - 1)}>
            <ChevronLeftIcon />
          </button>
        )}
        {index < files.length - 1 && (
          <button className="lightbox-nav next" aria-label="Next image" onClick={() => onIndex(index + 1)}>
            <ChevronRightIcon />
          </button>
        )}
      </div>

      {showInfo && (
        <aside className="lightbox-info">
          <section>
            <h3>Share</h3>
            <div className="segmented" role="tablist" aria-label="Snippet format">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={format === f}
                  className={format === f ? "on" : ""}
                  onClick={() => {
                    setFormat(f);
                    writePref("share-format", f);
                  }}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
            {!isGif && (
              <select
                aria-label="Image size"
                value={size}
                onChange={(e) => {
                  setSize(e.target.value as Size);
                  writePref("share-size", e.target.value);
                }}
              >
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {SIZE_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
            <div className="snippet">
              <code>{code}</code>
            </div>
            <button className="primary block" onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : `Copy ${format === "url" ? "link" : FORMAT_LABELS[format]}`}
            </button>
          </section>

          <section>
            <h3>Details</h3>
            <dl className="details">
              <dt>Name</dt>
              <dd title={file.original_name}>{file.original_name}</dd>
              <dt>Folder</dt>
              <dd title={folderLabel}>{folderLabel}</dd>
              <dt>Type</dt>
              <dd>{formatType(file.content_type)}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(file.size)}</dd>
              <dt>Uploaded</dt>
              <dd>{formatDateTime(file.created_at)}</dd>
            </dl>
          </section>

          <section className="lightbox-actions">
            <button onClick={() => onMove(file)}>
              <FolderInputIcon />
              Move
            </button>
            <button className="danger-soft" onClick={() => onDelete(file)}>
              <TrashIcon />
              Delete
            </button>
          </section>
        </aside>
      )}
    </div>
  );
}
