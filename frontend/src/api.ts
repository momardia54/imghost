export class UnauthorizedError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, options);
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface MeResponse {
  authenticated: boolean;
  setupRequired: boolean;
}

export function getMe(): Promise<MeResponse> {
  return request("/api/me");
}

export function setup(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function login(username: string, password: string): Promise<{ ok: true }> {
  return request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<{ ok: true }> {
  return request("/api/logout", { method: "POST" });
}

export interface FolderNode {
  id: number;
  parent_id: number | null;
  name: string;
  count: number;
}

export interface TreeResponse {
  folders: FolderNode[];
  total: number;
}

export function getTree(): Promise<TreeResponse> {
  return request("/api/tree");
}

export function createFolder(name: string, parentId: number | null): Promise<FolderNode> {
  return request("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent_id: parentId }),
  });
}

export function renameFolder(id: number, name: string): Promise<{ ok: true }> {
  return request(`/api/folders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function deleteFolder(id: number): Promise<{ ok: true }> {
  return request(`/api/folders/${id}`, { method: "DELETE" });
}

export interface FileItem {
  id: number;
  folder_id: number | null;
  r2_key: string;
  original_name: string;
  content_type: string;
  size: number;
  created_at: string;
  url: string;
}

export interface FilesResponse {
  files: FileItem[];
  total: number;
  page: number;
  pageSize: number;
}

export function listFiles(opts: { folderId: number | null; scope?: "all"; page: number; limit: number }): Promise<FilesResponse> {
  const params = new URLSearchParams();
  if (opts.scope === "all") {
    params.set("scope", "all");
  } else if (opts.folderId !== null) {
    params.set("folder_id", String(opts.folderId));
  }
  params.set("page", String(opts.page));
  params.set("limit", String(opts.limit));
  return request(`/api/files?${params.toString()}`);
}

export function moveFile(id: number, folderId: number | null): Promise<{ ok: true }> {
  return request(`/api/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_id: folderId }),
  });
}

export function deleteFile(id: number): Promise<{ ok: true }> {
  return request(`/api/files/${id}`, { method: "DELETE" });
}

export function uploadFile(
  file: File,
  folderId: number | null,
  onProgress: (pct: number) => void
): Promise<FileItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener("load", () => {
      let data: unknown = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // ignore parse errors, handled below via status check
      }
      if (xhr.status === 401) {
        reject(new UnauthorizedError());
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as FileItem);
      } else {
        reject(new Error((data as { error?: string }).error || `Upload failed (${xhr.status})`));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));

    const form = new FormData();
    form.append("file", file);
    if (folderId !== null) form.append("folder_id", String(folderId));
    xhr.send(form);
  });
}
