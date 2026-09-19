# imghost

A tiny, self-hosted alternative to [freeimage.host](https://freeimage.host), built to run entirely on
Cloudflare's free tier — **Workers**, **D1**, and **R2**. Single account, folder tree, drag & drop
upload, and a direct copyable link per image.

## Features

- **Single-account, no public registration**: the admin username/password are set as Cloudflare
  Workers secrets (`ADMIN_USERNAME`/`ADMIN_PASSWORD`), not created through the app itself — there's
  no sign-up endpoint at all, so there's nothing for a bot to race you to on a freshly deployed,
  not-yet-configured instance.
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

The button walks you through connecting your Cloudflare account, provisions the Worker, D1
database, and R2 bucket for you, **and prompts you right there in the dashboard for the two admin
credential values** (`ADMIN_USERNAME`/`ADMIN_PASSWORD`, declared in `.dev.vars.example`) — no separate post-deploy step needed when using the button.

**Known gotcha:** `wrangler.jsonc` in this repo has a `d1_databases[0].database_id` baked in — it
has to, so that *this* repo's own Git-connected auto-deploy keeps working — but that ID belongs to
the database in the original deployer's account, not yours. When you use the button, Cloudflare
creates a *new* D1 database in your account but doesn't rewrite that ID in your fork, so the first
build fails with something like `D1 binding 'DB' references database '...' which was not found`.

Fix it in one command, from your own machine, no manual `wrangler d1 list`/copy-paste needed:

```bash
npm run deploy
```

`scripts/ensure-d1.mjs` runs first and is self-healing: it looks up (or creates, if missing) a D1
database named `imghost-db` in your account and rewrites `wrangler.jsonc`'s `database_id`
automatically, every time, before `wrangler deploy` ever runs. Commit and push the file it updates
so future pushes stay in sync. (This step has to run *before* `wrangler deploy` starts, not inside
its own `build.command` — Wrangler reads the D1 binding config before invoking that hook, so a
file rewrite during the build step is too late for that same deploy. Confirmed by testing both
orderings directly.) After that, open your Worker's URL and log in with the credentials you gave
the button.

**This self-heal only covers deploys you trigger yourself** (`npm run deploy`, or any deploy
where you control the command). The dashboard's Git-connected auto-deploy-on-push always runs a
fixed **Deploy command** (default `npx wrangler deploy`), which Cloudflare doesn't let a repo
file customize — so if the D1 database is ever deleted again and you rely only on push-triggered
deploys, that pipeline alone will hit the same stale-ID failure until either (a) you run
`npm run deploy` locally once, which fixes and commits the correct id for future pushes to reuse,
or (b) you change that one dashboard field yourself to
`node scripts/ensure-d1.mjs && npx wrangler deploy`.

### Manual deploy

If you'd rather do it from the CLI:

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create imghost-images
```

No manual D1 setup step — `npm run deploy` finds or creates the `imghost-db` database and wires
its real `database_id` into `wrangler.jsonc` automatically before deploying (see the Known gotcha
above for exactly why this has to happen as a separate step before `wrangler deploy`, not inside
its `build.command`).

For the **very first deploy**, the Worker doesn't exist yet, so `wrangler secret put` won't work
(`wrangler` will tell you exactly this if you try) — supply the credentials via a file instead:

```bash
cat > /tmp/imghost-secrets.txt <<'EOF'
ADMIN_USERNAME=your-username
ADMIN_PASSWORD=your-password
EOF
node scripts/ensure-d1.mjs && npm run build && npx wrangler deploy --secrets-file /tmp/imghost-secrets.txt
rm /tmp/imghost-secrets.txt
```

After that first deploy, the Worker exists and both secrets are set, so every deploy after this
one is just:

```bash
npm run deploy
```

To rotate a credential later, `wrangler secret put ADMIN_USERNAME`/`ADMIN_PASSWORD` now works fine
(see [Account recovery](#account-recovery)) — it only fails against a Worker that doesn't exist
yet. The secrets are **not** required for a deploy to succeed: if you create the Worker manually in
the Cloudflare dashboard (no Deploy button) it builds fine without them, and the login page shows a
"Not configured yet" screen explaining where to add `ADMIN_USERNAME`/`ADMIN_PASSWORD` (Worker →
Settings → Variables and Secrets). They take effect immediately, no redeploy needed.

If your Cloudflare login has access to more than one account, either pass
`--account-id <id>` to the commands above, or export it once:

```bash
export CLOUDFLARE_ACCOUNT_ID=your-account-id
```

Open the Worker's `*.workers.dev` URL (or your custom domain, if you've attached one) and log in.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in ADMIN_USERNAME/ADMIN_PASSWORD for local login
npm install
npm run dev
```

This runs the Worker locally with wrangler's local D1/R2 emulation at `http://localhost:8787` — no
Cloudflare resources are touched. `.dev.vars` is gitignored; `wrangler dev` reads it automatically.

If you rebuild the frontend (`npm run build`) while `wrangler dev` is already running, its local
asset watcher can get into a stale state (serving old/broken assets, sometimes returning HTML for
JS requests with no visible error). If the page loads blank after a rebuild, stop `wrangler dev`,
`rm -rf .wrangler/state`, and restart rather than trusting the hot reload.

## How it's built

- **Backend** is a single Worker with plain `fetch`-based routing (`src/index.ts`) — no framework.
- **D1** stores sessions, API keys, the folder tree, and file metadata (admin credentials live in
  Workers secrets, not D1). Schema is
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

## Account recovery

Admin credentials are Workers secrets, not something the app stores or manages itself, so recovery
is just setting them again:

```bash
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

Each prompts interactively for the new value — nothing to type on the command line, nothing to
mask, no custom recovery script or email flow needed. If your Cloudflare login has access to more
than one account, export `CLOUDFLARE_ACCOUNT_ID` first (see [Manual deploy](#manual-deploy)
above). Changes take effect immediately; no redeploy required.

Email-based ("forgot password") recovery was considered and deliberately skipped: on Workers you'd
need to integrate a transactional email API (Resend, SendGrid, Mailchannels, etc.), which means new
secrets to manage, a sending domain, and a new failure mode (misconfigured email = permanently
locked out, or a phishing/abuse surface if ever misused) — for a problem the two commands above
already solve with no new infrastructure at all.

## Security notes

This was built with a few deliberate hardening choices worth knowing about:

- **Credentials never touch D1 or the repo**: the admin username/password are Cloudflare Workers
  secrets (`ADMIN_USERNAME`/`ADMIN_PASSWORD`), encrypted at rest by Cloudflare — there's no
  password hash sitting in the database to protect from a dump, and no public registration
  endpoint for a bot to race you to on a freshly deployed instance (see
  [Account recovery](#account-recovery) above for how this replaced an earlier D1-backed account
  system).
- **Login comparison is constant-time and doesn't leak which field was wrong**: username and
  password are folded into a single SHA-256 comparison (`verifyAdminCredentials` in
  `src/auth.ts`) rather than looking up a username first and only then checking the password —
  that pattern lets an attacker distinguish "unknown username" from "known username, wrong
  password" by response time. One combined comparison, always full cost, nothing to time.
- **Sessions**: a random 256-bit token stored server-side in a `sessions` table (not just a signed
  cookie), so logging out actually invalidates it. Cookie is `HttpOnly; Secure; SameSite=Lax`.
- **Login rate limiting**: failed login attempts are tracked per IP in D1; after 8 failures in 15
  minutes further attempts are rejected with a 429 until the window clears. This is per-IP, not
  global or per-account — a distributed attacker rotating source IPs isn't fully stopped by this
  alone, an accepted tradeoff for a personal single-admin tool.
- **Uploads are sniffed, not trusted**: the server checks the actual file bytes (magic numbers)
  against the claimed type rather than trusting the browser-supplied `Content-Type` — this blocks
  a relabeled non-image file from being accepted.
- **No SVG uploads**: SVG is an XML/HTML-adjacent format that can carry `<script>` and event
  handlers. Since direct links are served from the same origin as the admin app, a malicious SVG
  would otherwise be a stored-XSS vector against your own session. JPG/PNG/GIF/WebP/AVIF only.
- **Response headers**: every response gets `Content-Security-Policy` (no inline scripts/styles
  allowed), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, and `Strict-Transport-Security`.
- **No SQL injection surface**: every D1 query uses parameterized `?` bindings — user input is
  never concatenated into SQL. Request bodies are also type-checked before binding (a JSON object
  or array where a folder id is expected returns a clean `400`, not an unhandled D1 type error).
- **API keys**: stored as a SHA-256 hash (the plaintext token is shown once, at creation, and
  never persisted or retrievable again) and scoped to upload-only, per the [Remote / API
  upload](#remote--api-upload) section above.
- **Delete ordering favors invisible-but-harmless over visibly-broken**: deleting a file or folder
  removes the D1 row(s) before the R2 object(s). If the D1 step fails, nothing changed (safe to
  retry). If the R2 step fails afterward, the result is an orphaned-but-harmless leftover object in
  R2 rather than a broken (404) image left sitting in the gallery. Uploads use the opposite,
  equally deliberate order (R2 write, then D1 insert, with a compensating R2 delete if the D1
  insert fails) — the goal in both directions is the same: prefer an invisible storage leak over a
  visibly broken app state.

## Limits

- 10MB per upload (`MAX_SIZE` in `src/routes/files.ts`).
- Single account only — this isn't a multi-user tool.
- Cloudflare's free tier limits apply: Workers requests/day, D1 storage/reads/writes, R2 storage
  and Class A/B operations. For personal image hosting these are generous, but check current
  Cloudflare pricing if you expect heavy traffic.
