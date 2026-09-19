function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type FolderRow = { id: number; parent_id: number | null; name: string };

export async function handleTree(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare("SELECT id, parent_id, name FROM folders ORDER BY name COLLATE NOCASE")
    .all<FolderRow>();
  return json({ folders: results ?? [] });
}

export async function handleCreateFolder(req: Request, db: D1Database): Promise<Response> {
  const body = await req.json<{ name?: string; parent_id?: number | null }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return json({ error: "Folder name required" }, 400);

  const parentId = body?.parent_id ?? null;
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
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }

  // ON DELETE CASCADE on folders/files handles the rest once the root folder is removed.
  await db.prepare("DELETE FROM folders WHERE id = ?").bind(folderId).run();

  return json({ ok: true });
}
