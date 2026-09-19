import {
  createSession,
  destroySessionFromRequest,
  hashPassword,
  verifyPassword,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
} from "../auth";

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const MAX_ATTEMPTS_PER_WINDOW = 8;
const WINDOW_MINUTES = 15;

function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function isRateLimited(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM login_attempts
       WHERE ip = ? AND attempted_at > datetime('now', '-${WINDOW_MINUTES} minutes')`
    )
    .bind(ip)
    .first<{ count: number }>();
  return (row?.count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW;
}

async function recordFailedAttempt(db: D1Database, ip: string): Promise<void> {
  await db.prepare("INSERT INTO login_attempts (ip) VALUES (?)").bind(ip).run();
}

async function clearAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export async function handleSetup(req: Request, db: D1Database): Promise<Response> {
  const existing = await db.prepare("SELECT id FROM account LIMIT 1").first();

  if (req.method === "GET") {
    return json({ setupRequired: !existing });
  }

  if (existing) {
    return json({ error: "Account already exists" }, 409);
  }

  const body = await req.json<{ username?: string; password?: string }>().catch(() => null);
  const username = body?.username?.trim();
  const password = body?.password;
  if (!username || !password || password.length < 8) {
    return json({ error: "Username required, password must be at least 8 characters" }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  await db
    .prepare("INSERT INTO account (username, password_hash, salt) VALUES (?, ?, ?)")
    .bind(username, hash, salt)
    .run();

  const token = await createSession(db);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function handleLogin(req: Request, db: D1Database): Promise<Response> {
  const ip = clientIp(req);
  if (await isRateLimited(db, ip)) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await req.json<{ username?: string; password?: string }>().catch(() => null);
  if (!body?.username || !body?.password) {
    return json({ error: "Username and password required" }, 400);
  }

  const account = await db
    .prepare("SELECT username, password_hash, salt FROM account WHERE username = ?")
    .bind(body.username)
    .first<{ username: string; password_hash: string; salt: string }>();

  if (!account || !(await verifyPassword(body.password, account.password_hash, account.salt))) {
    await recordFailedAttempt(db, ip);
    return json({ error: "Invalid credentials" }, 401);
  }

  await clearAttempts(db, ip);
  const token = await createSession(db);
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

export async function handleLogout(req: Request, db: D1Database): Promise<Response> {
  await destroySessionFromRequest(req, db);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}

export async function handleMe(req: Request, db: D1Database): Promise<Response> {
  const authed = await getSessionFromRequest(req, db);
  const hasAccount = !!(await db.prepare("SELECT id FROM account LIMIT 1").first());
  return json({ authenticated: authed, setupRequired: !hasAccount });
}
