const SESSION_COOKIE = "imghost_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Workers' free plan caps CPU time at 10ms/request. 100k PBKDF2-SHA256 iterations
// (~OWASP's floor) leaves headroom; raising this risks login requests being killed
// for exceeding the CPU limit unless you're on a paid Workers plan.
const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBufferLike): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const derived = await pbkdf2(password, saltBytes);
  return { hash: toHex(derived), salt: toHex(saltBytes.buffer) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await pbkdf2(password, fromHex(salt));
  const derivedHex = toHex(derived);
  if (derivedHex.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= derivedHex.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
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
