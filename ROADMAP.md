# Roadmap

imghost stays a single-admin image host on Cloudflare's free tier. Items below are candidates, not
promises; order is rough priority.

## 1.0.x: hardening

- [ ] Verify on a live deployment: GIF uploads, folder-delete variant cleanup, login rate limit (429)
  (all covered by the local test suite; not yet observed in production)
- [ ] Verify the Deploy button end to end on a fresh account, including the Images binding
- [ ] Make first deploys independent of the committed D1 `database_id` (Wrangler's automatic
  resource provisioning), so the Deploy button and Git builds never hit a stale id

## 1.1: library

- [ ] Strip EXIF metadata (GPS location) from uploads, on by default
- [ ] Export the library (zip of originals plus a folder manifest) for backups and migrations
- [ ] Rename images
- [ ] Store image dimensions at upload and show them in the lightbox and list view
- [ ] Drag folders to re-parent them
- [ ] Undo for moves and deletes (short grace period before R2 deletion)

## 1.2: sharing

- [ ] Per-image view counts (D1 daily counters, skipping same-origin requests)
- [ ] Arbitrary widths via bucketed `?w=` (rounded to a few sizes to stay within the free transformation quota)
- [ ] Optional custom domain guide for `/i/*` links
- [ ] Upload from a URL (fetch a remote image server-side)
- [ ] Duplicate detection on upload (content hash)

## Not planned

- Multiple user accounts
- Email-based password recovery (credentials are Workers secrets; rotate with `wrangler secret put`)
- SVG uploads (stored-XSS risk on a same-origin image path)
