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
  const offset = (page - 1) * pageSize;

  const whereClause = scope === "all" ? "" : folderId === null ? "WHERE folder_id IS NULL" : "WHERE folder_id = ?";
  const bindArgs = scope === "all" || folderId === null ? [] : [folderId];

  const countRow = await db
    .prepare(`SELECT COUNT(*) as total FROM files ${whereClause}`)
    .bind(...bindArgs)
    .first<{ total: number }>();

  const { results } = await db
    .prepare(`SELECT * FROM files ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
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
  const folderId =
    typeof folderIdRaw === "string" && folderIdRaw.length > 0 ? Number(folderIdRaw) : null;

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

  const inserted = await db
    .prepare(
      `INSERT INTO files (folder_id, r2_key, original_name, content_type, size)
       VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`
    )
    .bind(folderId, key, safeName, sniffedType, bytes.byteLength)
    .first<{ id: number; created_at: string }>();

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

  const body = await req.json<{ folder_id?: number | null }>().catch(() => null);
  if (!body || !("folder_id" in body)) {
    return json({ error: "folder_id required" }, 400);
  }
  const folderId = body.folder_id;

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

  await bucket.delete(row.r2_key);
  await db.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();

  return json({ ok: true });
}
