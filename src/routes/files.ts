import { variantKeys } from "./serve";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

// SVG is intentionally NOT supported: it's an XML/HTML-adjacent format that can carry
// <script>/event-handler payloads, and since /i/:key serves files same-origin, a
// maliciously crafted "image" would execute with the app's own session cookie in scope.
// Detecting the real format from magic bytes (rather than trusting the client-supplied
// Content-Type) blocks MIME-spoofed uploads (e.g. an .html file relabeled image/png).
function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    bytes[11] === 0x66
  ) {
    return "image/avif";
  }
  return null;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Returns the value as a folder id (number or null for root), or `undefined` if it's some other
// JSON shape (object, array, boolean, NaN, ...) — callers should treat `undefined` as a 400,
// rather than letting it reach a D1 `.bind()` call and crash with an unhandled D1_TYPE_ERROR.
function parseFolderId(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

type FileRow = {
  id: number;
  folder_id: number | null;
  r2_key: string;
  original_name: string;
  content_type: string;
  size: number;
  created_at: string;
};

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

// Whitelisted ORDER BY clauses; `id` breaks ties so pagination is stable.
const ORDER_BY: Record<string, string> = {
  newest: "created_at DESC, id DESC",
  oldest: "created_at ASC, id ASC",
  name: "original_name COLLATE NOCASE ASC, id ASC",
  size: "size DESC, id DESC",
};

export async function handleListFiles(req: Request, db: D1Database): Promise<Response> {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const folderParam = url.searchParams.get("folder_id");
  const folderId = folderParam !== null ? Number(folderParam) : null;

  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_PAGE_SIZE)
  );
  // `offset` (when given) takes precedence over `page`: infinite scroll asks for "everything after
  // what I already show", which stays correct after items are deleted or moved out of the view.
  const offsetParam = url.searchParams.get("offset");
  const offset = offsetParam !== null ? Math.max(0, Math.floor(Number(offsetParam)) || 0) : (page - 1) * pageSize;
  const orderBy = ORDER_BY[url.searchParams.get("sort") ?? ""] ?? ORDER_BY.newest;

  // Name search spans every folder; otherwise a folder listing is recursive: it includes files
  // in every descendant folder too.
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const recursive = !q && scope !== "all" && folderId !== null;
  const cte = recursive
    ? `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM folders WHERE id = ?
         UNION ALL
         SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
       )`
    : "";
  const whereClause = q
    ? "WHERE original_name LIKE ? ESCAPE '\\'"
    : recursive
      ? "WHERE folder_id IN (SELECT id FROM descendants)"
      : scope === "all"
        ? ""
        : "WHERE folder_id IS NULL";
  const bindArgs: unknown[] = q
    ? [`%${q.replace(/[\\%_]/g, "\\$&")}%`]
    : recursive
      ? [folderId]
      : [];

  const countRow = await db
    .prepare(`${cte} SELECT COUNT(*) as total FROM files ${whereClause}`)
    .bind(...bindArgs)
    .first<{ total: number }>();

  const { results } = await db
    .prepare(`${cte} SELECT * FROM files ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .bind(...bindArgs, pageSize, offset)
    .all<FileRow>();

  const files = (results ?? []).map((f) => ({ ...f, url: `/i/${f.r2_key}` }));
  return json({ files, total: countRow?.total ?? 0, page, pageSize });
}

export async function handleUpload(
  req: Request,
  db: D1Database,
  bucket: R2Bucket,
  origin: string
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return json({ error: "Invalid form data" }, 400);

  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided" }, 400);

  const folderIdRaw = form.get("folder_id");
  const folderId = parseFolderId(typeof folderIdRaw === "string" ? folderIdRaw : null);
  if (folderId === undefined) {
    return json({ error: "Invalid folder_id" }, 400);
  }

  if (folderId !== null) {
    const parent = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first();
    if (!parent) return json({ error: "Folder not found" }, 404);
  }

  if (file.size > MAX_SIZE) {
    return json({ error: "File exceeds 10MB limit" }, 400);
  }
  if (file.size === 0) {
    return json({ error: "Empty file" }, 400);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniffedType = sniffImageType(bytes);
  if (!sniffedType) {
    return json({ error: "Unsupported or unrecognized image file" }, 400);
  }

  const ext = EXT_BY_TYPE[sniffedType] ?? "bin";
  const key = `${crypto.randomUUID()}.${ext}`;
  const safeName = file.name.slice(0, 255);

  await bucket.put(key, bytes, { httpMetadata: { contentType: sniffedType } });

  let inserted: { id: number; created_at: string } | null;
  try {
    inserted = await db
      .prepare(
        `INSERT INTO files (folder_id, r2_key, original_name, content_type, size)
         VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`
      )
      .bind(folderId, key, safeName, sniffedType, bytes.byteLength)
      .first<{ id: number; created_at: string }>();
  } catch (err) {
    console.error("upload: D1 insert failed", err);
    // The R2 object was already written — clean it up rather than leaving an orphan with no
    // DB row pointing to it (it would otherwise be permanently invisible to the app).
    await bucket.delete(key).catch(() => {});
    return json({ error: "Upload failed, please try again" }, 500);
  }

  return json(
    {
      id: inserted?.id,
      folder_id: folderId,
      r2_key: key,
      original_name: safeName,
      content_type: sniffedType,
      size: bytes.byteLength,
      created_at: inserted?.created_at,
      url: `${origin}/i/${key}`,
    },
    201
  );
}

export async function handleMoveFile(fileId: number, req: Request, db: D1Database): Promise<Response> {
  const existing = await db.prepare("SELECT id FROM files WHERE id = ?").bind(fileId).first();
  if (!existing) return json({ error: "File not found" }, 404);

  const body = await req.json<{ folder_id?: unknown }>().catch(() => null);
  if (!body || !("folder_id" in body)) {
    return json({ error: "folder_id required" }, 400);
  }
  const folderId = parseFolderId(body.folder_id);
  if (folderId === undefined) {
    return json({ error: "Invalid folder_id" }, 400);
  }

  if (folderId !== null) {
    const parent = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first();
    if (!parent) return json({ error: "Folder not found" }, 404);
  }

  await db.prepare("UPDATE files SET folder_id = ? WHERE id = ?").bind(folderId, fileId).run();
  return json({ ok: true, folder_id: folderId });
}

export async function handleDeleteFile(fileId: number, db: D1Database, bucket: R2Bucket): Promise<Response> {
  const row = await db
    .prepare("SELECT r2_key FROM files WHERE id = ?")
    .bind(fileId)
    .first<{ r2_key: string }>();
  if (!row) return json({ error: "File not found" }, 404);

  // D1 delete first, R2 delete after: if the D1 step fails, nothing changed (safe to retry). If
  // the R2 step fails after D1 succeeded, the row is already gone from every listing — the worst
  // case is an invisible, harmless leftover R2 object, not a broken (404) image left in the
  // gallery.
  await db.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();
  await bucket.delete([row.r2_key, ...variantKeys(row.r2_key)]);

  return json({ ok: true });
}

// Bulk operations. D1 allows at most 100 bound parameters per statement, so ids are processed in
// chunks; a request may name up to MAX_BULK images.
const MAX_BULK = 500;
const CHUNK = 90;

function parseIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK) return null;
  if (!value.every((v) => Number.isInteger(v) && v > 0)) return null;
  return [...new Set(value as number[])];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const placeholders = (n: number) => Array(n).fill("?").join(",");

export async function handleBulkMove(req: Request, db: D1Database): Promise<Response> {
  const body = await req.json<{ ids?: unknown; folder_id?: unknown }>().catch(() => null);
  const ids = parseIds(body?.ids);
  if (!ids) return json({ error: `ids must be 1-${MAX_BULK} positive integers` }, 400);
  if (!body || !("folder_id" in body)) return json({ error: "folder_id required" }, 400);
  const folderId = parseFolderId(body.folder_id);
  if (folderId === undefined) return json({ error: "Invalid folder_id" }, 400);

  if (folderId !== null) {
    const parent = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first();
    if (!parent) return json({ error: "Folder not found" }, 404);
  }

  const results = await db.batch(
    chunks(ids, CHUNK).map((c) =>
      db.prepare(`UPDATE files SET folder_id = ? WHERE id IN (${placeholders(c.length)})`).bind(folderId, ...c)
    )
  );
  const moved = results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  return json({ ok: true, moved, folder_id: folderId });
}

export async function handleBulkDelete(req: Request, db: D1Database, bucket: R2Bucket): Promise<Response> {
  const body = await req.json<{ ids?: unknown }>().catch(() => null);
  const ids = parseIds(body?.ids);
  if (!ids) return json({ error: `ids must be 1-${MAX_BULK} positive integers` }, 400);

  const keys: string[] = [];
  for (const c of chunks(ids, CHUNK)) {
    const { results } = await db
      .prepare(`SELECT r2_key FROM files WHERE id IN (${placeholders(c.length)})`)
      .bind(...c)
      .all<{ r2_key: string }>();
    keys.push(...(results ?? []).map((r) => r.r2_key));
  }

  // Same order as handleDeleteFile: D1 rows first (atomic batch), then R2 objects and variants.
  await db.batch(chunks(ids, CHUNK).map((c) => db.prepare(`DELETE FROM files WHERE id IN (${placeholders(c.length)})`).bind(...c)));
  const objects = keys.flatMap((k) => [k, ...variantKeys(k)]);
  for (const c of chunks(objects, 1000)) await bucket.delete(c);

  return json({ ok: true, deleted: keys.length });
}
