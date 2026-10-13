const SESSION_COOKIE = "imghost_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function toHex(buf: ArrayBufferLike): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Admin credentials live in Workers secrets (ADMIN_USERNAME/ADMIN_PASSWORD), not D1 — nothing to
// protect from a database dump, so there's no need for PBKDF2's deliberate slowness here (that
// mattered when a password hash was persisted; it isn't anymore). Username and password are
// folded into a single hash-and-compare specifically so there's no separate "does the username
// match" branch to short-circuit on — a naive `username === expected && password === expected`
// (or a DB lookup that skips password verification on an unknown username) leaks which part
// failed via response timing. One combined comparison, always full cost, nothing to time.
export async function verifyAdminCredentials(
  username: string,
  password: string,
  expectedUsername: string,
  expectedPassword: string
): Promise<boolean> {
  const presented = await sha256Hex(`${username}\0${password}`);
  const expected = await sha256Hex(`${expectedUsername}\0${expectedPassword}`);
  return constantTimeEqual(presented, expected);
}

export function newSessionToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

export async function createSession(db: D1Database): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO sessions (token, expires_at) VALUES (?, ?)")
    .bind(token, expiresAt)
    .run();
  return token;
}

export async function getSessionFromRequest(req: Request, db: D1Database): Promise<boolean> {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const token = match[1];
  const row = await db
    .prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();
  return !!row;
}

export async function destroySessionFromRequest(req: Request, db: D1Database): Promise<void> {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return;
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(match[1]).run();
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

const API_KEY_PREFIX = "imghost_sk_";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

// API key tokens are high-entropy random secrets (192 bits), unlike human passwords, so a
// plain fast hash is appropriate here — no need for PBKDF2's deliberate slowness.
export async function generateApiKey(): Promise<{ token: string; hash: string; prefix: string }> {
  const token = API_KEY_PREFIX + toHex(crypto.getRandomValues(new Uint8Array(24)).buffer);
  const hash = await sha256Hex(token);
  const prefix = token.slice(0, 12);
  return { token, hash, prefix };
}

export async function hashApiKeyToken(token: string): Promise<string> {
  return sha256Hex(token);
}

export async function getApiKeyFromRequest(
  req: Request,
  db: D1Database
): Promise<{ id: number } | null> {
  const header = req.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(\S+)$/);
  if (!match) return null;
  const token = match[1];
  if (!token.startsWith(API_KEY_PREFIX)) return null;

  const hash = await hashApiKeyToken(token);
  const row = await db.prepare("SELECT id FROM api_keys WHERE key_hash = ?").bind(hash).first<{ id: number }>();
  if (!row) return null;

  await db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").bind(row.id).run();
  return { id: row.id };
}
