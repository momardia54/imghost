# imghost

Self-hosted image host on Cloudflare's free tier (Workers + D1 + R2). Single admin account, nested
folders, drag & drop upload, direct public links, upload API.

## Features

- Nested folders: expand/collapse, inline rename, drag-and-drop to move images
- Folder view is recursive (includes sub-folders) and shows clickable sub-folder cards
- Multi-file upload with progress. JPG, PNG, GIF, WebP, AVIF, max 10MB each
- Paginated gallery ("All images" or per folder)
- Public direct links: `/i/<key>`
- Resized WebP variants via `/i/<key>?size=thumb|small|medium|large` (200/400/800/1600px)
- Upload API with revocable API keys
- Admin credentials stored as Workers secrets

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/imghost)

The button provisions the Worker, D1 database and R2 bucket, and prompts for `ADMIN_USERNAME` and
`ADMIN_PASSWORD`.

If the first build fails with `D1 binding 'DB' references database '...' which was not found`, run
once from a clone:

```bash
npm install
npx wrangler login
npm run deploy
```

Commit and push the updated `wrangler.jsonc`.

### Manual deploy (CLI)

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create imghost-images
npm run deploy
```

`npm run deploy` runs `scripts/ensure-d1.mjs` (finds or creates the `imghost-db` D1 database and
writes its id into `wrangler.jsonc`), builds the frontend, then runs `wrangler deploy`.

For a multi-account login:

```bash
export CLOUDFLARE_ACCOUNT_ID=<account-id>
```

### Manual deploy (dashboard, Git-connected)

1. Workers & Pages → Create → import the repo.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
3. After the first deploy, add the credentials as **runtime** secrets:
   Worker → Settings → **Variables and Secrets** → add `ADMIN_USERNAME` and `ADMIN_PASSWORD`
   (type: Secret).

> Do not add them under Settings → Build → Variables and secrets. Those are build-time only and the
> Worker cannot read them.

Until both secrets exist, the login page shows "Not configured yet". Secrets apply immediately, no
redeploy needed.

Push-triggered deploys use the fixed deploy command above. If the D1 database is recreated, either
run `npm run deploy` locally once and push the updated `wrangler.jsonc`, or set the dashboard
Deploy command to `node scripts/ensure-d1.mjs && npx wrangler deploy`.

## Configuration

| Name | Type | Where | Description |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | Secret | Worker runtime | Login username |
| `ADMIN_PASSWORD` | Secret | Worker runtime | Login password |

| Binding | Resource | Name |
| --- | --- | --- |
| `DB` | D1 | `imghost-db` |
| `IMAGES` | R2 | `imghost-images` |
| `TRANSFORM` | Images (transformations) | n/a |
| `ASSETS` | Static assets | `frontend-dist/` |

Set or rotate secrets from the CLI (also the account recovery path):

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

For a Worker that doesn't exist yet, pass them with the first deploy instead:

```bash
printf 'ADMIN_USERNAME=user\nADMIN_PASSWORD=pass\n' > secrets.env
npx wrangler deploy --secrets-file secrets.env && rm secrets.env
```

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in ADMIN_USERNAME / ADMIN_PASSWORD
npm install
npm run dev                      # http://localhost:8787
```

If the page loads blank after rebuilding while `wrangler dev` is running: stop it,
`rm -rf .wrangler/state`, rebuild, restart.

Typecheck:

```bash
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.frontend.json
```

## Upload API

Create a key in the UI (sidebar → **API keys**). The token is shown once.

```bash
curl -X POST https://<your-worker>.workers.dev/api/upload \
  -H "Authorization: Bearer imghost_sk_..." \
  -F "file=@photo.png" \
  -F "folder_id=<optional>"
```

Response (201): `id`, `folder_id`, `r2_key`, `original_name`, `content_type`, `size`,
`created_at`, `url`.

API keys authorize `POST /api/upload` only. All other routes require the session cookie. No CORS
headers on the upload endpoint.

## HTTP API (session cookie)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/login` | Log in (`username`, `password`) |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | `{ authenticated, configured }` |
| GET | `/api/tree` | Folders with recursive image counts, total |
| POST | `/api/folders` | Create folder (`name`, `parent_id`) |
| PATCH | `/api/folders/:id` | Rename |
| DELETE | `/api/folders/:id` | Delete folder, descendants and their files |
| GET | `/api/files` | List. Query: `folder_id`, `scope=all`, `page`, `limit` (max 100). Folder listings include sub-folders |
| POST | `/api/upload` | Upload (session or API key) |
| PATCH | `/api/files/:id` | Move (`folder_id`) |
| DELETE | `/api/files/:id` | Delete |
| GET/POST | `/api/keys` | List / create API keys |
| DELETE | `/api/keys/:id` | Revoke an API key |
| GET | `/i/:key` | Public image (no auth) |

## Image variants

`GET /i/<key>?size=<preset>` returns a WebP resized to the preset width (no upscaling).

| Preset | Width |
| --- | --- |
| `thumb` | 200 |
| `small` | 400 |
| `medium` | 800 |
| `large` | 1600 |

- Without `size`, or with an unknown value, the original is returned
- Generated on first request via the Images binding, stored in R2 under `thumbs/<preset>/<key>`,
  served from R2 afterwards
- Variants are deleted with their image or folder
- GIFs are always served as the original
- Free tier: 5,000 unique transformations per month
- If the `TRANSFORM` binding is missing, `?size=` falls back to the original

## Architecture

```
src/            Worker (fetch router, no framework)
  routes/       auth, folders, files, serve, apiKeys
  auth.ts       credential check, sessions, API keys
  db.ts         D1 schema, applied lazily on first request
  security.ts   CSP and security headers
frontend/       React + TypeScript, built with Vite into frontend-dist/
scripts/        ensure-d1.mjs
```

- D1: sessions, API keys, folders, file metadata
- R2: image bytes, keyed by random UUID (independent of folder path)
- Assets: SPA served through the `ASSETS` binding

## Security

- Credentials are Workers secrets, compared via a single SHA-256 check
- Sessions: 256-bit random token in D1; cookie `HttpOnly; Secure; SameSite=Lax`
- Login rate limit: 8 failures per 15 minutes per IP
- Uploads validated by magic bytes; SVG rejected
- Headers: CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
  HSTS
- Parameterized D1 queries only
- API keys: SHA-256 hashed at rest, upload-only

## Limits

- 10MB per upload
- Single admin account
- Fixed size presets only, no arbitrary dimensions or editing
- Sidebar counts include sub-folders
- Cloudflare free-tier quotas apply (Workers requests, D1, R2)
