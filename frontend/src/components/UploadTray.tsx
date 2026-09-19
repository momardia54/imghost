import { useRef, useState } from "react";
import { UnauthorizedError, uploadFile } from "../api";

type UploadState = {
  id: string;
  name: string;
  progress: number;
  status: "uploading" | "done" | "error";
  errorMessage?: string;
};

const CONCURRENCY = 3;

export default function UploadTray({
  folderId,
  onUploaded,
  onUnauthorized,
}: {
  folderId: number | null;
  onUploaded: () => void;
  onUnauthorized: () => void;
}) {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function updateUpload(id: string, patch: Partial<UploadState>) {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }

  async function runQueue(files: File[]) {
    const queue = files.map((file, i) => ({
      id: `${Date.now()}-${i}-${file.name}`,
      file,
    }));

    setUploads((prev) => [
      ...prev,
      ...queue.map((q) => ({ id: q.id, name: q.file.name, progress: 0, status: "uploading" as const })),
    ]);

    let index = 0;
    let unauthorized = false;

    async function worker() {
      while (index < queue.length) {
        if (unauthorized) return;
        const item = queue[index++];
        try {
          await uploadFile(item.file, folderId, (pct) => updateUpload(item.id, { progress: pct }));
          updateUpload(item.id, { status: "done", progress: 100 });
          onUploaded();
        } catch (err) {
          if (err instanceof UnauthorizedError) {
            unauthorized = true;
            onUnauthorized();
            return;
          }
          updateUpload(item.id, {
            status: "error",
            errorMessage: err instanceof Error ? err.message : "Upload failed",
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  }

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    runQueue(Array.from(fileList));
  }

  return (
    <>
      <div
        className={"dropzone" + (dragOver ? " dragover" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        Drag &amp; drop images here, or{" "}
        <button onClick={() => fileInputRef.current?.click()}>choose files</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="dropzone-hint">JPG, PNG, GIF, WebP, AVIF — up to 10MB each, multiple at once</div>
      </div>

      {uploads.length > 0 && (
        <div className="upload-tray">
          <h3>Uploads</h3>
          {uploads.map((u) => (
            <div className="upload-row" key={u.id}>
              <span className="upload-name" title={u.name}>
                {u.name}
              </span>
              <progress value={u.status === "error" ? 0 : u.progress} max={100} />
              <span className={"upload-status " + u.status}>
                {u.status === "uploading" && `${u.progress}%`}
                {u.status === "done" && "Done"}
                {u.status === "error" && (u.errorMessage || "Failed")}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
