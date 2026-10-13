import { deleteFiles as apiDeleteFiles, moveFiles as apiMoveFiles } from "../api";
import { toast, toastError } from "../components/Toast";

export type Selection = { type: "all" } | { type: "unsorted" } | { type: "folder"; id: number };

export const DRAG_TYPE = "text/x-imghost-file-ids";

export function setDraggedIds(e: React.DragEvent, ids: number[]): void {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "move";
}

export function isInternalDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_TYPE);
}

export function readDraggedIds(e: React.DragEvent): number[] {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
    return Array.isArray(ids) ? ids.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

const BULK_LIMIT = 500;

async function inChunks(ids: number[], fn: (chunk: number[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += BULK_LIMIT) await fn(ids.slice(i, i + BULK_LIMIT));
}

const images = (n: number) => (n === 1 ? "1 image" : `${n} images`);

export async function moveFiles(ids: number[], folderId: number | null, folderName: string): Promise<boolean> {
  if (ids.length === 0) return false;
  try {
    await inChunks(ids, (c) => apiMoveFiles(c, folderId));
    toast(`Moved ${images(ids.length)} to ${folderName}`);
    return true;
  } catch (err) {
    toastError(err, `Could not move ${images(ids.length)}`);
    return false;
  }
}

export async function deleteFiles(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return false;
  try {
    await inChunks(ids, apiDeleteFiles);
    toast(`Deleted ${images(ids.length)}`);
    return true;
  } catch (err) {
    toastError(err, `Could not delete ${images(ids.length)}`);
    return false;
  }
}
