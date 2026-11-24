# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [2.4.0] - 2026-11-24

Scale, portability and polish (roadmap Phase 6).

### Added
- **Importers** with preview, dedupe and undo: browser bookmarks HTML,
  Raindrop CSV, Pocket (HTML/JSON), Karakeep, Linkwarden, YouTube Takeout
  playlists, plain URL lists. Pure hostile-safe parsers + fixtures + tests.
- **Exporters**: CSV and Netscape HTML bookmarks alongside full-fidelity JSON.
- **Trash**: deletes move to a recoverable trash with auto-purge (30 days
  default); restore / delete-forever actions; expiry purge at boot.
- **Smart views**: Recent, Opened, Untagged, Duplicates (normalized URL),
  Broken, Trash — with live counts.
- **Opt-in link health check** (`/api/check`, capped batch, two concurrent
  SSRF-guarded HEAD probes) feeding the Broken view.
- **Rolling backups** before risky operations, configurable window
  (`REELKEEP_BACKUPS_KEEP`, default 10).
- **Performance**: precomputed search index, `content-visibility` offscreen
  culling, `decoding="async"` covers; `scripts/benchmark.mjs` 10k-item budget
  gate in CI. Measured: 598 ms boot, 90 ms search at 10,000 items
  (`docs/performance.md`).
- Demo seeds every item type and shows a demo banner + repo link.
- Docs: `import-export.md`, `faq.md`, `performance.md`, public `ROADMAP.md`,
  `CODE_OF_CONDUCT.md`, translation issue template.

### Changed
- Delete confirmations now describe the trash honestly, in all 11 languages.

## [2.3.0] - 2026-11-24

Companion-server hardening (roadmap Phase 5). Archiving stays deferred by
owner decision; it is documented as a future opt-in, not built.

### Added
- **Optional password auth** (`REELKEEP_PASSWORD`): constant-time comparison,
  HMAC-signed `HttpOnly; SameSite=Strict` session cookie, per-IP login rate
  limiting, login dialog in the app (boot + mid-session 401), "use browser
  storage instead" escape. Non-loopback binds without a password **refuse to
  start** unless `REELKEEP_ALLOW_INSECURE=1` (loud warning).
- **Security headers**: tight CSP (`script-src 'self'`, no inline scripts —
  player.html's script moved to `player.js`/`player.css`), `Referrer-Policy:
  no-referrer`, minimal `Permissions-Policy`, `X-Frame-Options: SAMEORIGIN`.
  Player telemetry postMessage now origin-pinned both ways.
- **Docker**: pinned Node LTS alpine image, non-root user, `/data` volume,
  healthcheck; `docker-compose.yml` requiring a password; `docs/deploy.md`
  with Caddy/nginx reverse-proxy examples.
- **Single-file binaries**: SEA asset build (`scripts/build-sea.mjs`,
  `node:sea` materialization, data in `REELKEEP_DATA`/cwd) and a release
  workflow building linux/macos/windows binaries + SHA-256 checksums,
  extension zips, and a ghcr.io image from tags. Verified locally on Windows.
- Auth/headers test suite (gate, cookie, tamper, rate limit, unsafe startup).

### Changed
- `docs/deploy.md` documents unsigned-binary OS prompts honestly (Gatekeeper,
  SmartScreen) with checksums as the trust anchor.

## [2.2.0] - 2026-11-24

One-click saving from the browser (roadmap Phase 4).

### Added
- **MV3 extension** (`extension/`, builds in `dist/` via `npm run build:ext`):
  toolbar popup (type/folder/tags/notes + optional current playback time),
  context menus for page/link/image/selection, page-context metadata extraction.
- Origin-pinned handoff: `postMessage` into an open library tab, or a consumed
  `#reelkeep-save=` hash payload when opening it; undelivered saves queue in
  `chrome.storage.local` and flush later.
- Minimal permissions (`activeTab`, `scripting`, `contextMenus`, `storage`) with
  optional per-origin host permissions requested at use time; strict CSP; no
  remote code, no eval, no innerHTML (test-enforced).
- `extension/PRIVACY.md`, `extension/store/` listing copy + permission
  justifications, `docs/extension.md`; Firefox manifest variant from same source.
- Popup strings in all 11 languages (`ext.*`); handoff toast translated.
- Tests: extension hygiene suite + headless smoke (Edge) covering install,
  popup, worker messaging and both handoff channels.

## [2.1.0] - 2026-11-24

Browser-only mode becomes a first-class citizen, and the app installs.

### Added
- **PWA**: web app manifest, generated icons (192/512/maskable, dependency-free
  PNG encoder in `scripts/gen-icons.mjs`), service worker caching the app shell
  for offline use. Updates wait for an explicit "Reload" toast — no stuck old
  versions, no mid-session rug-pull.
- **Folder mode** (Chrome/Edge desktop): pick a real folder; `library.json`,
  `thumbnails/`, `videos/`, `files/`, `backups/` live there, the same layout the
  server uses. The directory handle persists in IndexedDB; permission is
  re-requested gracefully via the storage dialog.
- **Fallback modes**: OPFS where available, else IndexedDB, else localStorage —
  capability-detected, never user-agent sniffed. The footer always states the
  active mode and its limits; a storage dialog switches modes and carries the
  library across.
- **Multi-tab safety**: revision counter + BroadcastChannel. Stale whole-library
  writes are refused (409/conflict) and merged by `updatedAt` with deletion
  tombstones — two tabs never silently lose data (tested in both tiers).
- **Offline mirror** for server mode: the last synced library is kept in browser
  storage and served read-only, clearly labeled, when the server is unreachable.
- Careful verified writes in handle storage: rolling backup → temp → verify →
  main → verify; a crash never truncates the library.
- Tests: storage conformance contract (server + local in Node, handle storage in
  the browser smoke), merge/tombstone unit tests, multi-tab + offline smoke.

### Fixed
- Handle-storage write verification compared compact vs pretty JSON (false
  failures on every save).
- Going offline no longer silently switches storage tier; the remembered mode
  is kept and the offline mirror engages instead.

## [2.0.0] - 2026-11-24

The universal library: ReelKeep keeps everything now, not just video.
Existing v1/v2 libraries load unchanged (migration tested, backed up).

### Added
- Six new item types, each with add/edit/search/tag/folder/delete/export/import,
  grid + list cards, viewer, tests and translations: **article/link** (metadata
  reader + opt-in local reader copy), **image** (zoom/pan), **audio** (player with
  0.5–2× speed), **PDF** (sandboxed browser viewer), **note** (safe Markdown),
  **file** (size/MIME/SHA-256, download).
- Add dialog becomes **Add item**: type auto-detection from paste/drop with a
  manual override, plus a Note tab. Type filter joins folder/tag/source filters.
- **Resume position** for video and audio, offered as a chip — never forced;
  explicit start-at points are preserved.
- **Export / Import** toolbar actions: full-fidelity JSON, import preview with
  duplicate detection, undoable imports, pre-import backups; browser-only
  exports inline small files so the bundle round-trips alone.
- Security (applies from the moment the features exist): SSRF defense on every
  server-side fetch (DNS-resolved private-range blocking, connections pinned to
  the validated IP, redirect re-validation, caps); cross-origin write refusal
  (Origin/Host check); upload content sniffing; web-executable uploads refused;
  reader snapshots stored as text blocks only (sanitized by construction);
  security test suite in CI.
- `POST /api/snapshot`, `POST /api/files` (generic intake), inline serving for
  viewer-safe kinds (`?inline=1`), enrich now returns description/author/
  publishedAt.
- `docs/i18n-status.md`; aria-labels translated; ~60 new keys in all 11 languages.
- `docs/screenshot-types.png` and `docs/screenshot-types-rtl.png`.

### Changed
- Product voice is universal: "Add item", "All items", item counts, new tagline —
  in all 11 languages.
- Markdown notes render through a minimal allowlisted renderer built from DOM
  nodes; links limited to http/https/mailto with `rel="noopener noreferrer"`.

## [1.6.0] - 2026-11-24

Foundations for the universal library (roadmap Phases 0–1). No visible UI change;
existing libraries load exactly as before.

### Added
- `docs/audit.md`: full code audit (module map, data flow, every route, every
  read/write and remote fetch, known bugs) plus a golden v1 fixture and
  characterization tests pinning the semantics the refactor must preserve.
- Universal item schema v2 (`docs/data-format.md`): one envelope for every item
  type, type-specific `data`, forward-compatible (unknown fields preserved).
- Migration framework (`js/migrations.mjs`): ordered, pure, idempotent;
  `data/videos.json` → `data/library.json` on first load with an automatic
  backup in `backups/`; the legacy file is never deleted. Newer-schema
  libraries open read-only and are never rewritten.
- Storage interface (`js/storage.mjs`) with server and browser-storage adapters;
  library core (`js/library.mjs`) with serialized, debounced whole-library saves
  flushed on tab hide, and rollback + visible error when a save fails.
- Item handler registry with `video` and generic `link` handlers; adding a type
  is now a new handler file plus registration.
- `app.js` split into ES modules (`js/`): views, lightbox, dialogs, thumbnail
  picker, folders, drag & drop, keyboard, auto-enrichment. No bundler.
- New API: `GET/PUT /api/library`, `/api/items` CRUD + move, `DELETE /api/files`,
  `GET/POST /api/backups`. Legacy `/api/videos*`, `/api/folders*`, `/api/state`
  kept as a compatibility surface over the universal store.
- Tests: migration losslessness/idempotency/future-version (unit), server
  migration integration (backup, legacy preservation, restart), i18n key parity
  across all 11 languages, `npm run check` syntax lint in CI.
- `docs/architecture.md`, `docs/data-format.md`; `backups/`, `files/`,
  `data/library.json` gitignored.

### Fixed
- Twitch embeds never played: the parser's `kind: 'vods'/'clip'` overwrote the
  record kind, bypassing the provider embed branch. Detection fixed; migration
  normalizes existing records.
- Stored-XSS via `/api/thumbnails/from-url`: the saved extension came from the
  URL path, so a hostile "image" at `…/evil.html` was served as HTML from the
  app origin. Extension now derives from the content type only.
- Corrupt-library recovery returned an envelope without `folders`; it now
  always includes both arrays.
- Write failures were swallowed (`console.error` only); they now propagate to
  the caller and surface in the UI.
- Symlinks inside media folders could escape the served roots; realpaths are
  re-checked. `nosniff` on all responses; `/files/` downloads as attachment.
- Malformed Host header could throw outside the route try/catch.
- Hard-coded English card-action titles and preview strings now go through i18n
  (all 11 languages); duplicate `Accept-Language` header in enrich removed.

### Changed
- Branding standardized to **ReelKeep** everywhere (UI, README, docs, player);
  favicon and demo badge use the broadcast-blue accent instead of retired indigo.
- Storage file is `data/library.json`; footer, docs and translations updated.
- Honest limit: ES modules do not load from `file://`, so double-clicking
  `index.html` no longer boots the app. Browser-only mode works over any static
  host (as the live demo does); `node server.js` remains the full experience.

## [1.5.0] - 2026-11-22

### Added
- Merged the Figma design's strengths into the screening-room identity: page heading
  ("Your library" + count + tagline) with organization controls on their own row; slim
  topbar with live storage status; labeled Select/Group/Thumbnail/Edit/Open-original
  buttons; TAGS micro-label with an "All tags" reset chip; product-voice microcopy
  (heading tagline, add-dialog subtitle and privacy line) in all 11 languages.
- Add dialog: folder field at add time, integrated link-preview row with detected
  title/source and a "Video details found" status, right-aligned field hints.
- Player: "Back to library" labeled button, provider/folder breadcrumb, position
  indicator ("N of M videos"), notes under the stage, visible keyboard hints,
  framed 1280px stage on a darker surround, circular edge navigation.
- Thumbnail picker: single large frame preview with ms-precision stamp, source tabs
  (Capture a frame / Use an image), custom scrubber with accent elapsed fill,
  ±1s stepping around a precise mono time input, toggle switch for start-at-frame.
- Chunked rendering with "Showing N of M / Load more" for large libraries.
- Duration on cards for link-added videos: `/api/enrich` now parses ISO-8601
  (`itemprop="duration"`, JSON-LD) and seconds (`og:video:duration`, `video:duration`)
  page metadata; the add dialog shows it in the detected-preview subline and stores it;
  existing embeds without a duration are backfilled lazily at boot (4 at a time).
  Vimeo falls back to its oEmbed API (its pages expose no duration meta).
  Sites that expose no duration still show no stamp — honestly.
- Mobile: compact topbar with overflow menu for organization controls, square add
  button in the heading, horizontally scrollable folder row, single-column gallery.
- Toggle-switch styling for all boolean switches; warm-grey Figma neutral palette
  (`#101113/#18191d/#2c2e35`) with sage status green; dialog radius 12px.
- `docs/screenshot-add.png` and `docs/screenshot-mobile.png`.

### Fixed
- Latent translator shadowing bugs (`const t = …` inside `openThumbPicker`'s error
  handler and `seekFromInput`) that would throw on frame-read failure / invalid time.
- Add-dialog tab handler no longer toggles the picker's source tabs (scoped selectors).
- Add-dialog method tabs (Link / Embed code / Upload file) now share equal thirds of
  the dialog width instead of packing left at content size.

### Kept (deliberately not adopted from Figma)
- Broadcast-blue accent with dark text (Figma's `#7278E8` + white fails AA and is the
  cloned AI-indigo); drag dock/ghost/hot-state; list ledger; empty/selection/move/
  confirm/toast surfaces; group-by-source slates; native playback controls (custom
  transport is impossible for cross-origin embeds); system font stacks (no webfont
  downloads); fluid widths + RTL logical properties instead of fixed 1440/600/880px.

## [1.4.0] - 2026-11-22

### Changed
- Visual identity pass ("screening room"): squared 6px/4px corners instead of pillowy
  radii and pill chips; flat hairline surfaces with no card shadows, lift or thumbnail
  zoom; broadcast-blue accent replaces startup indigo; monospace voice for the wordmark,
  counts, timestamps, hosts, tags and micro-labels; contact-sheet grid and hairline
  ledger list; slate section rules; left-aligned editorial empty states; 120ms
  colour-only motion; outline-based focus rings; Firefox scrollbar parity.
- `docs/ui-brief.md` restored and rewritten as a prescriptive identity handoff (the old
  constraints-only brief made every agent converge on the same generic look).
- Refinements merging the previous design's strengths into the new identity: meta
  slates 11px in `--muted` for legibility; ledger rows keep two-line titles (15px) and
  two-line notes; card corners softened to 8px (controls stay 4px); accent-tinted hover
  borders for click affordance without lift; larger play disc, badge and stamp; empty
  state settled at 480px max-width.

### Added
- `docs/screenshot-list.png` and a list-view capture step in `scripts/screenshot.mjs`.
- Drag ergonomics: while dragging, the folder bar becomes a fixed bottom dock of large
  (46px) drop targets reachable at any scroll position; the drag image is a compact
  mono ghost placed above the pointer so the target under the cursor stays visible;
  hot target is a solid accent fill; gallery dims during drag; folder chips larger at
  rest. `docs/screenshot-drag.png` documents the mid-drag state.

## [1.3.0] - 2026-11-21

### Added
- Internationalization: 11 languages (English, Arabic, Russian, French, German, Spanish,
  Simplified Chinese, Japanese, Korean, Hindi, Turkish) via a dependency-free `i18n.js`
  runtime; toolbar language selector, browser-language detection, remembered choice,
  locale-aware dates, and full right-to-left layout for Arabic.
- Folder action bar when a folder is open: Empty folder (move contents to Unfiled),
  Rename, Delete folder.
- Drag affordances: folder chips outline as drop targets while cards are dragged; the
  hovered chip highlights; highlights survive moving across chip children.

### Changed
- Deleting a folder now deletes its member videos too, with a confirmation stating the
  count; uploaded files on disk are never touched. Empty folder is the non-destructive
  alternative.
- Edit-dialog thumbnail fills its 16:9 holder (provider stills no longer show black bars).

### Fixed
- Dragging a card by its thumbnail no longer starts a native image drag that opened the
  add-link dialog on drop; internal card drops are ignored by the upload/link path.
- Source filter label re-translates on language change.

## [1.2.0] - 2026-11-21

### Added
- Folders: named collections with live counts, one folder per video, *Unfiled* fallback.
  Move videos by dragging cards onto folder chips or via selection mode + move dialog;
  create, rename and delete folders (deleting only unfiles their videos).
- Group-by-source toggle (`G`): clusters the filtered gallery into labelled per-source
  sections; composes with folders, tags, search and both layouts; choice remembered.
- Folder badges on cards in the *All videos* view; selection mode with checkboxes.
- API: `POST /api/folders`, `PATCH`/`DELETE /api/folders/:id`, `POST /api/videos/move`
  (atomic batch), `folders` in `/api/state`, `folderId` on video records.
- Example library ships two folders; README gains folder/grouping docs and two screenshots.

## [1.1.0] - 2026-11-21

### Added
- Live browser demo on GitHub Pages, seeded with the example library
  (`https://deekx.github.io/ReelKeep/`).
- Zero-dependency smoke test suite (`npm test`, `node:test`) and CI across
  Linux/macOS/Windows × Node 18/20/22.
- Frame-picker screenshot and refreshed gallery/player screenshots in the
  README; keyboard-shortcut table and API reference (`docs/api.md`).
- Community files: CONTRIBUTING, SECURITY, issue/PR templates, changelog.
- `scripts/screenshot.mjs` dev tool to refresh README screenshots from the
  running app via headless Chrome.

### Changed
- Visual refresh: flat dark surfaces, single restrained accent, no gradients
  or glassmorphism.
- Cross-platform quickstart (Windows, macOS, Linux) and `npm start` alias.
- Browser-only mode plays direct video URLs without the `/media` proxy and
  disables frame picking where cross-origin pixels are unreadable.

### Fixed
- Static server no longer serves the library JSON, server source or repo
  internals (e.g. `.git/`) — relevant when running with `HOST=0.0.0.0`.
- Uploads accept only media extensions; other extensions fall back to `.mp4`
  instead of being served as their original type.
- Malformed percent-encoded paths return 400 instead of 500.

## [1.0.0] - 2026-11-20

### Added
- Initial public release: zero-dependency Node server, vanilla JS gallery and
  unified player, 13 provider parsers plus generic page-metadata enrichment,
  uploads with drag & drop, frame-accurate thumbnails, tags/search/sort,
  grid/list layouts, keyboard shortcuts, plain-JSON storage with atomic
  writes, example seed library, MIT license.
