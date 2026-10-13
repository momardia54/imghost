import { useEffect, useRef, useState } from "react";
import { UnauthorizedError, uploadFile } from "../api";
import { copyToClipboard } from "../clipboard";
import { AlertCircleIcon, CheckIcon, ChevronDownIcon, LinkIcon, UploadIcon, XIcon } from "../icons";
import { toast } from "./Toast";

type UploadState = {
  id: string;
  name: string;
  preview: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  url?: string;
  errorMessage?: string;
};

const CONCURRENCY = 3;
const MAX_SIZE = 10 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];
export const ACCEPT_ATTR = ACCEPTED.join(",");

let startUpload: ((files: File[]) => void) | null = null;

export function uploadFiles(files: FileList | File[] | null): void {
  if (files && files.length > 0) startUpload?.(Array.from(files));
}

function isFileDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export default function UploadHost({
  folderId,
  folderName,
  onUploaded,
  onUnauthorized,
}: {
  folderId: number | null;
  folderName: string;
  onUploaded: () => void;
  onUnauthorized: () => void;
}) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const dragDepth = useRef(0);

  // Latest props for callbacks registered once.
  const latest = useRef({ folderId, onUploaded, onUnauthorized });
  latest.current = { folderId, onUploaded, onUnauthorized };

  function patch(id: string, p: Partial<UploadState>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...p } : u)));
  }

  async function runQueue(files: File[]) {
    const target = latest.current.folderId;
    const stamp = Date.now();
    const items = files.map((file, i) => {
      const id = `${stamp}-${i}`;
      let errorMessage: string | undefined;
      if (!ACCEPTED.includes(file.type)) errorMessage = "Not a supported image";
      else if (file.size > MAX_SIZE) errorMessage = "Larger than 10 MB";
      return { id, file, errorMessage };
    });

    setCollapsed(false);
    setUploads((prev) => [
      ...items.map((it) => ({
        id: it.id,
        name: it.file.name,
        preview: it.errorMessage ? "" : URL.createObjectURL(it.file),
        progress: 0,
        status: it.errorMessage ? ("error" as const) : ("queued" as const),
        errorMessage: it.errorMessage,
      })),
      ...prev,
    ]);

    const queue = items.filter((it) => !it.errorMessage);
    let index = 0;
    let unauthorized = false;
    let done = 0;

    async function worker() {
      while (index < queue.length && !unauthorized) {
        const item = queue[index++];
        patch(item.id, { status: "uploading" });
        try {
          const res = await uploadFile(item.file, target, (pct) => patch(item.id, { progress: pct }));
          patch(item.id, { status: "done", progress: 100, url: res.url });
          done++;
          latest.current.onUploaded();
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            unauthorized = true;
            latest.current.onUnauthorized();
            return;
          }
          patch(item.id, { status: "error", errorMessage: err instanceof Error ? err.message : "Upload failed" });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    if (done > 0) toast(done === 1 ? "1 image uploaded" : `${done} images uploaded`);
  }

  useEffect(() => {
    startUpload = (files) => void runQueue(files);

    // Dropping files anywhere on the window uploads them; internal tile drags carry no "Files" type.
    function onDragEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      dragDepth.current++;
      setDragging(true);
    }
    function onDragOver(e: DragEvent) {
      if (isFileDrag(e)) e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    }
    function onDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      uploadFiles(e.dataTransfer?.files ?? null);
    }
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (files.length === 0) return;
      e.preventDefault();
      uploadFiles(files);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      startUpload = null;
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearFinished() {
    setUploads((prev) => {
      prev.filter((u) => u.status === "done" || u.status === "error").forEach((u) => u.preview && URL.revokeObjectURL(u.preview));
      return prev.filter((u) => u.status === "queued" || u.status === "uploading");
    });
  }

  async function copy(u: UploadState) {
    if (!u.url || !(await copyToClipboard(u.url))) return;
    setCopiedId(u.id);
    setTimeout(() => setCopiedId((cur) => (cur === u.id ? null : cur)), 1500);
  }

  const active = uploads.filter((u) => u.status === "queued" || u.status === "uploading").length;
  const failed = uploads.filter((u) => u.status === "error").length;
  const finished = uploads.length - active;
  const succeeded = finished - failed;
  const title =
    active > 0
      ? `Uploading ${finished + 1} of ${uploads.length}`
      : [succeeded ? `${succeeded} uploaded` : "", failed ? `${failed} failed` : ""].filter(Boolean).join(" · ");

  return (
    <>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-card">
            <UploadIcon />
            <strong>Drop to upload</strong>
            <span>to {folderName}</span>
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <section className={"upload-panel" + (collapsed ? " collapsed" : "")} aria-label="Uploads">
          <header>
            <span className={"upload-panel-title" + (active > 0 ? " busy" : "")}>{title}</span>
            <button className="icon-btn" aria-label={collapsed ? "Expand" : "Collapse"} onClick={() => setCollapsed((c) => !c)}>
              <ChevronDownIcon className={collapsed ? "flip" : ""} />
            </button>
            {active === 0 && (
              <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={clearFinished}>
                <XIcon />
              </button>
            )}
          </header>
          {!collapsed && (
            <ul>
              {uploads.map((u) => (
                <li key={u.id} className={u.status}>
                  <span className="upload-thumb">{u.preview ? <img src={u.preview} alt="" /> : <AlertCircleIcon />}</span>
                  <span className="upload-meta">
                    <span className="upload-name" title={u.name}>
                      {u.name}
                    </span>
                    {u.status === "error" ? (
                      <span className="upload-error">{u.errorMessage}</span>
                    ) : u.status === "done" ? (
                      <span className="upload-done">Uploaded</span>
                    ) : (
                      <progress value={u.progress} max={100} />
                    )}
                  </span>
                  {u.status === "done" && (
                    <button className="icon-btn" title="Copy link" aria-label="Copy link" onClick={() => copy(u)}>
                      {copiedId === u.id ? <CheckIcon /> : <LinkIcon />}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
