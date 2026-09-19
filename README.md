# imghost

A tiny, self-hosted alternative to [images.host](https://images.host), built to run entirely on
Cloudflare's free tier — **Workers**, **D1**, and **R2**. Single account, folder tree, drag & drop
upload, and a direct copyable link per image.

## Features

- **Single-account**: the first visit prompts you to create the one admin account; every visit
  after that is a login.
- **Folders**: nested folders with expand/collapse, inline rename, and drag-and-drop to move an
  image into a folder.
- **Upload**: drag & drop or pick multiple files at once, uploaded in parallel with a per-file
  progress bar. JPG, PNG, GIF, WebP, AVIF — up to 10MB each.
- **Gallery**: a flat, paginated "All images" view across every folder, or browse one folder at a
  time.
- **Direct links**: every uploaded image gets a stable, public `/i/<key>` URL you can copy and
  share — no auth required to view it.
- **Remote/API upload**: generate an API key in the UI and upload images from a script or an AI
  coding agent without a browser session — see [Remote / API upload](#remote--api-upload) below.
- **Runs on the free tier**: one Worker, one D1 database, one R2 bucket. No servers to manage.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/imghost)

The button walks you through connecting your Cloudflare account and provisions the Worker, D1
database, and R2 bucket for you. After it finishes, open your new Worker's URL — the first visit
will prompt you to create the admin account.

### Manual deploy

If you'd rather do it from the CLI:

```bash
npm install
npx wrangler login

# Create the D1 database and R2 bucket
npx wrangler d1 create imghost-db
npx wrangler r2 bucket create imghost-images
```

Take the `database_id` printed by `wrangler d1 create` and paste it into `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "imghost-db",
    "database_id": "PASTE_YOUR_DATABASE_ID_HERE"
  }
]
```

Then deploy:

```bash
npx wrangler deploy
```

If your Cloudflare login has access to more than one account, either pass
`--account-id <id>` to the commands above, or export it once:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Open the Worker's `*.workers.dev` URL (or your custom domain, if you've attached one) and create
the admin account on first visit.

## Local development

```bash
npm install
npm run dev
```

This runs the Worker locally with wrangler's local D1/R2 emulation at `http://localhost:8787` — no
Cloudflare resources are touched.

## How it's built

- **Backend** is a single Worker with plain `fetch`-based routing (`src/index.ts`) — no framework.
- **D1** stores the account, sessions, API keys, the folder tree, and file metadata. Schema is
  applied lazily on first request (`src/db.ts`) — no separate migration step to run.
- **R2** stores the actual image bytes, addressed by a random UUID key that's decoupled from the
  folder path, so moving/renaming folders never breaks an existing shared link.
- **Frontend** is React + TypeScript (`frontend/`), built with Vite and served as a single-page
  app from the Worker via the `assets` binding. `wrangler.jsonc`'s `build.command` runs
  `npm run build` automatically before every `wrangler deploy`/`dev`, so this is self-contained —
  no separate build step to remember, whether deploying via the CLI, the dashboard's Git
  integration, or the Deploy button.

## Remote / API upload

Besides the browser UI, images can be uploaded programmatically — handy for scripts, CI, or an AI
coding agent that should be able to drop in an image and get a link back.

1. Log in, open **API keys** in the sidebar, and create a named key (e.g. `my-ai-agent`). The full
   token is shown **once** — copy it immediately, it can't be retrieved again (only its prefix is
   kept, for identifying it in the list later).
2. Upload with it:
   ```bash
   curl -X POST https://your-worker.workers.dev/api/upload \
     -H "Authorization: Bearer imghost_sk_..." \
     -F "file=@photo.png" \
     -F "folder_id=optional"
   ```
   The response is the same JSON the browser upload gets back, including `url` — the direct link.

API keys are intentionally **upload-only**: a key can't list, delete, or move files, browse
folders, or mint/revoke other keys — only `POST /api/upload` accepts a key, everything else still
requires the browser session cookie. If a key leaks, the blast radius is "someone can add images,"
not "someone can read or wipe the library." Revoke a key any time from the same panel.

Note: this endpoint has no CORS headers, since it's meant for server-side/CLI callers (curl, a
Node/Python script, an agent's tool runner) rather than browser JavaScript running on another
origin — CORS wouldn't apply either way for that kind of caller.

## Security notes

This was built with a few deliberate hardening choices worth knowing about:

- **Passwords**: hashed with PBKDF2-SHA256 (Web Crypto, no native dependencies). Iteration count
  is set to 100,000 rather than the higher counts some guidance recommends — Cloudflare Workers'
  **free plan caps CPU time at 10ms per request**, and pushing iterations much higher risks login
  requests being killed for exceeding that budget. If you're on a paid Workers plan you can safely
  raise `PBKDF2_ITERATIONS` in `src/auth.ts`.
- **Sessions**: a random 256-bit token stored server-side in a `sessions` table (not just a signed
  cookie), so logging out actually invalidates it. Cookie is `HttpOnly; Secure; SameSite=Lax`.
- **Login rate limiting**: failed login attempts are tracked per IP in D1; after 8 failures in 15
  minutes further attempts are rejected with a 429 until the window clears.
- **Uploads are sniffed, not trusted**: the server checks the actual file bytes (magic numbers)
  against the claimed type rather than trusting the browser-supplied `Content-Type` — this blocks
  a relabeled non-image file from being accepted.
- **No SVG uploads**: SVG is an XML/HTML-adjacent format that can carry `<script>` and event
  handlers. Since direct links are served from the same origin as the admin app, a malicious SVG
  would otherwise be a stored-XSS vector against your own session. JPG/PNG/GIF/WebP/AVIF only.
- **Response headers**: every response gets `Content-Security-Policy` (no inline scripts/styles
  allowed), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
  `Referrer-Policy: no-referrer`.
- **No SQL injection surface**: every D1 query uses parameterized `?` bindings — user input is
  never concatenated into SQL.
- **API keys**: stored as a SHA-256 hash (the plaintext token is shown once, at creation, and
  never persisted or retrievable again) and scoped to upload-only, per the [Remote / API
  upload](#remote--api-upload) section above.

## Limits

- 10MB per upload (`MAX_SIZE` in `src/routes/files.ts`).
- Single account only — this isn't a multi-user tool.
- Cloudflare's free tier limits apply: Workers requests/day, D1 storage/reads/writes, R2 storage
  and Class A/B operations. For personal image hosting these are generous, but check current
  Cloudflare pricing if you expect heavy traffic.
