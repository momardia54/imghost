// Static assets bypass the Worker, so frontend/public/_headers carries a copy of these headers.
// Keep the two in sync.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", CSP);
  headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
