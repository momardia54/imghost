# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| < 1.0 | No |

Fixes ship in the latest release only. Deployed instances update when their owner redeploys from
the latest `main`.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue for security problems.

Include what you found, how to reproduce it, and the impact you expect. You should get a reply
within 7 days. Once a fix is released, the advisory is published with credit unless you prefer to
stay anonymous.

## Scope

In scope: the Worker (`src/`), the frontend (`frontend/`), the deploy script (`scripts/`) and the
default configuration in `wrangler.jsonc`, `frontend/public/_headers` and `src/security.ts`.

Out of scope: Cloudflare's platform itself, attacks that need the admin credentials or an API key
you were given, denial of service against the free-tier quotas, and missing hardening that is
documented below as a deliberate trade-off.

## Security model

- **One admin account.** Credentials live only in the Workers secrets `ADMIN_USERNAME` and
  `ADMIN_PASSWORD`. They are never stored in D1 or the repository. Login compares one SHA-256 of
  the username and password together, so a wrong username and a wrong password take the same path.
- **Sessions** are random tokens stored server-side in D1, sent as an `HttpOnly; Secure;
  SameSite=Lax` cookie.
- **Login rate limit:** 8 failed attempts per IP per 15 minutes. After that, even the correct
  password is refused until the window passes.
- **API keys** are stored as SHA-256 hashes, shown once, revocable, and can only call
  `POST /api/upload`. A leaked key can add images; it cannot list, move or delete anything.
- **Uploads** are identified by their magic bytes, not by the file name or the client's content
  type. Only JPEG, PNG, GIF, WebP and AVIF are accepted. SVG is rejected because images are served
  from the same origin as the app.
- **Public images:** anything uploaded is readable by anyone who has its `/i/<key>` link. Keys are
  random UUIDs, so links can't be guessed, but they are not secret once shared.
- **Headers:** a strict Content Security Policy (`'self'` only for scripts, styles and fonts, no
  inline styles), `X-Frame-Options: DENY`, `nosniff`, `no-referrer` and HSTS, on Worker responses
  and on static assets.

## Known limitations

- **Image metadata is not stripped.** Photos keep their EXIF data, which can include GPS
  coordinates, and it is served publicly with the original. Remove location data before uploading
  anything sensitive.
- The rate limit is per IP only. There is no global lockout, by design for a personal tool.
- No CORS on the upload endpoint: it is meant for servers and scripts, not browser code on other
  sites.
- No email-based recovery. Rotate credentials with `wrangler secret put`.

## Advice for people deploying imghost

- Use a long, unique password for `ADMIN_PASSWORD`.
- Set credentials as runtime secrets (Worker → Settings → Variables and Secrets), never as build
  variables or in `wrangler.jsonc`.
- Revoke API keys you no longer use, and rotate any key that may have leaked.
