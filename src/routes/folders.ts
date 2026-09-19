function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Same shape as the helper in routes/files.ts: `undefined` means "not a valid folder id",
// callers should 400 rather than let it reach a D1 `.bind()` call.
function parseFolderId(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

const MAX_NAME_LENGTH = 100;

type FolderRow = { id: number; parent_id: number | null; name: string };

export async function handleTree(db: D1Database): Promise<Response> {
  const [{ results: folders }, { results: counts }, totalRow] = await Promise.all([
    db.prepare("SELECT id, parent_id, name FROM folders ORDER BY name COLLATE NOCASE").all<FolderRow>(),
    db.prepare("SELECT folder_id, COUNT(*) as count FROM files WHERE folder_id IS NOT NULL GROUP BY folder_id").all<{
      folder_id: number;
      count: number;
    }>(),
    db.prepare("SELECT COUNT(*) as total FROM files").first<{ total: number }>(),
  ]);

  const countByFolder = new Map((counts ?? []).map((c) => [c.folder_id, c.count]));
  const foldersWithCounts = (folders ?? []).map((f) => ({ ...f, count: countByFolder.get(f.id) ?? 0 }));

  return json({ folders: foldersWithCounts, total: totalRow?.total ?? 0 });
}

export async function handleCreateFolder(req: Request, db: D1Database): Promise<Response> {
  const body = await req.json<{ name?: string; parent_id?: unknown }>().catch(() => null);
  const name = body?.name?.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return json({ error: "Folder name required" }, 400);

  const parentId = parseFolderId(body?.parent_id);
  if (parentId === undefined) {
    return json({ error: "Invalid parent_id" }, 400);
  }
  if (parentId !== null) {
    const parent = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(parentId).first();
    if (!parent) return json({ error: "Parent folder not found" }, 404);
  }

  const result = await db
    .prepare("INSERT INTO folders (parent_id, name) VALUES (?, ?) RETURNING id")
    .bind(parentId, name)
    .first<{ id: number }>();

  return json({ id: result?.id, name, parent_id: parentId }, 201);
}

export async function handleRenameFolder(folderId: number, req: Request, db: D1Database): Promise<Response> {
  const existing = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first();
  if (!existing) return json({ error: "Folder not found" }, 404);

  const body = await req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return json({ error: "Folder name required" }, 400);

  await db.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(name, folderId).run();
  return json({ ok: true, id: folderId, name });
}

async function collectDescendantIds(db: D1Database, rootId: number): Promise<number[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folders WHERE id = ?
        UNION ALL
        SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
      )
      SELECT id FROM descendants`
    )
    .bind(rootId)
    .all<{ id: number }>();
  return (results ?? []).map((r) => r.id);
}

export async function handleDeleteFolder(
  folderId: number,
  db: D1Database,
  bucket: R2Bucket
): Promise<Response> {
  const folder = await db.prepare("SELECT id FROM folders WHERE id = ?").bind(folderId).first();
  if (!folder) return json({ error: "Folder not found" }, 404);

  const ids = await collectDescendantIds(db, folderId);
  const placeholders = ids.map(() => "?").join(",");

  const { results: fileRows } = await db
    .prepare(`SELECT r2_key FROM files WHERE folder_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ r2_key: string }>();
  const keys = (fileRows ?? []).map((r) => r.r2_key);

  // D1 delete first, R2 delete after (same reasoning as handleDeleteFile): if the D1 step fails,
  // nothing changed yet. ON DELETE CASCADE on folders/files handles descendants once the root
  // folder is removed. If an R2 batch delete then fails, the rows are already gone from every
  // listing — worst case is a harmless, invisible leftover R2 object, not a broken image link.
  await db.prepare("DELETE FROM folders WHERE id = ?").bind(folderId).run();

  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }

  return json({ ok: true });
}
