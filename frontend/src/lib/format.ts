import { FileItem, FolderNode } from "../api";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// D1 timestamps are UTC without a zone marker ("2026-09-19 12:00:00").
export function parseDbDate(value: string): Date {
  return new Date(value.replace(" ", "T") + "Z");
}

export function formatDate(value: string | null): string {
  if (!value) return "never";
  return parseDbDate(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(value: string): string {
  return parseDbDate(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatType(contentType: string): string {
  return contentType.replace("image/", "").replace("jpeg", "jpg").toUpperCase();
}

export function absoluteUrl(file: FileItem, size?: string): string {
  const url = new URL(file.url, window.location.origin);
  if (size) url.searchParams.set("size", size);
  return url.href;
}

export function folderPath(folders: FolderNode[], id: number): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  let current = byId.get(id);
  while (current && path.length < 64) {
    path.unshift(current);
    current = current.parent_id !== null ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

export function childFolders(folders: FolderNode[], parentId: number | null): FolderNode[] {
  return folders.filter((f) => f.parent_id === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

export function pluralize(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}
