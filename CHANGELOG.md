# Changelog

All notable changes to imghost. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-13

First stable release. The UI was rebuilt from scratch on top of the existing Worker API.

### Added

- Lightbox viewer: keyboard navigation (←/→, Esc), neighbour preloading, download and open-original
- Share panel: copy as link, Markdown, HTML or BBCode, at original or any variant size
- Multi-select: checkboxes, Cmd/Ctrl-click, Shift-click ranges, Cmd/Ctrl+A
- Bulk actions: copy links, move, delete
- Move dialog with folder search (works without drag and drop, including on touch devices)
- "Unsorted" view for images that aren't in any folder
- Upload by dropping files anywhere on the window, or by pasting from the clipboard
- Floating upload panel with previews, progress, per-file errors and copy-link
- Client-side checks for file type and the 10 MB limit before uploading
- List view (name, folder, type, size, date) alongside the grid
- Sort by newest, oldest, name or size (`GET /api/files?sort=`)
- `offset` parameter on `GET /api/files`; infinite scroll uses it so deleting or moving images never
  makes later images disappear from the view
- Bulk endpoints `POST /api/files/move` and `POST /api/files/delete` (up to 500 ids per request);
  bulk actions in the UI use one request instead of one per image
- Test suite for the Worker (Vitest in the Workers runtime): auth, rate limiting, upload sniffing,
  listing, sorting, search, bulk actions, GIF passthrough, variant cleanup, API key scope
- GitHub Actions CI: typecheck, build and tests on every push and pull request
- OpenAPI 3.1 description of the HTTP API, served by every installation at `/openapi.json`; a test
  calls every documented operation to keep it in step with the router
- Thumbnail size slider; view, sort and size are remembered per browser
- Infinite scroll in place of numbered pages
- Storage meter against the R2 free tier (`GET /api/tree` now returns `bytes`)
- Toast notifications for every action, including errors that were silent before
- Keyboard shortcuts: `/` or Cmd/Ctrl+K to search, Delete to remove the selection, F2 to rename a folder
- New-sub-folder action on every folder in the tree
- Responsive layout with a slide-in sidebar on small screens
- App version shown in the sidebar and on the login page
- Example `curl` command in the API keys dialog
- `SECURITY.md` with the security model, known limitations and how to report a vulnerability

### Changed

- New visual design: Geist typography, neutral surfaces that keep attention on the images, refreshed
  light and dark themes
- Search moved to the top bar and covers images and folders
- Delete confirmations state what is lost (image counts, sub-folders, broken links)
- Fonts are bundled with the app instead of loaded from Google Fonts; the CSP drops
  `fonts.googleapis.com` and `fonts.gstatic.com`
- `img-src` in the CSP now allows `blob:` (local upload previews only)

### Removed

- The permanent dropzone above the gallery (replaced by window-wide drop and the Upload button)
- Numbered pagination

## Pre-1.0 milestones

These were never tagged as versions; they are listed for history.

### 2026-09-20

- Security headers on static assets via `frontend/public/_headers`

### 2026-09-19

- Recursive folder listings and sub-folder cards
- Admin secrets optional at deploy time, with a "not configured" screen
- Resized WebP variants via the Images binding (`?size=thumb|small|medium|large`)
- Logo, favicon, light/dark theme, MIT license
- Sidebar search for folders and images

### 2026-09-18

- Initial Worker + D1 + R2 image host with a React frontend
- Nested folders, drag-and-drop moves, multi-file upload
- Upload-only API keys
- Admin credentials moved to Workers secrets (closes the first-visitor-becomes-owner race)
- Self-healing D1 `database_id` for `npm run deploy`

[1.0.0]: https://github.com/momardia54/imghost/releases/tag/v1.0.0
