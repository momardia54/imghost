import {
  createSession,
  destroySessionFromRequest,
  verifyAdminCredentials,
  sessionCookieHeader,
  clearSessionCookieHeader,
  getSessionFromRequest,
} from "../auth";

interface AuthEnv {
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
}

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

export async function handleLogin(req: Request, db: D1Database, env: AuthEnv): Promise<Response> {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    return json({ error: "Admin credentials not configured on this deployment" }, 503);
  }

  const ip = clientIp(req);
  if (await isRateLimited(db, ip)) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const body = await req.json<{ username?: string; password?: string }>().catch(() => null);
  if (!body?.username || !body?.password) {
    return json({ error: "Username and password required" }, 400);
  }

  const valid = await verifyAdminCredentials(body.username, body.password, env.ADMIN_USERNAME, env.ADMIN_PASSWORD);
  if (!valid) {
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

export async function handleMe(req: Request, db: D1Database, env: AuthEnv): Promise<Response> {
  const authed = await getSessionFromRequest(req, db);
  const configured = !!env.ADMIN_USERNAME && !!env.ADMIN_PASSWORD;
  return json({ authenticated: authed, configured });
}
