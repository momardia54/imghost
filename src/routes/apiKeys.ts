import { generateApiKey } from "../auth";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ApiKeyRow = {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
};

export async function handleListApiKeys(db: D1Database): Promise<Response> {
  const { results } = await db
    .prepare("SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC")
    .all<ApiKeyRow>();
  return json({ keys: results ?? [] });
}

export async function handleCreateApiKey(req: Request, db: D1Database): Promise<Response> {
  const body = await req.json<{ name?: string }>().catch(() => null);
  const name = body?.name?.trim();
  if (!name) return json({ error: "Key name required" }, 400);

  const { token, hash, prefix } = await generateApiKey();

  const inserted = await db
    .prepare(
      `INSERT INTO api_keys (name, key_hash, key_prefix) VALUES (?, ?, ?)
       RETURNING id, created_at`
    )
    .bind(name, hash, prefix)
    .first<{ id: number; created_at: string }>();

  return json(
    {
      id: inserted?.id,
      name,
      token,
      key_prefix: prefix,
      created_at: inserted?.created_at,
    },
    201
  );
}

export async function handleRevokeApiKey(id: number, db: D1Database): Promise<Response> {
  const existing = await db.prepare("SELECT id FROM api_keys WHERE id = ?").bind(id).first();
  if (!existing) return json({ error: "Key not found" }, 404);

  await db.prepare("DELETE FROM api_keys WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
