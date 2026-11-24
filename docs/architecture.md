# ReelKeep architecture

Three tiers share one data format (`data-format.md`). A user can start at tier 1
and grow, or never leave it.

```
Tier 1  Web app (installable PWA)                        zero install; folder mode or browser storage
Tier 2  Browser extension (Phase 4)                    one-click save, cross-origin metadata
Tier 3  Companion server (node server.js)              files on disk, media proxy, enrichment
```

Storage adapters (`js/storage.mjs`, `js/storage-handles.mjs`, `js/storage-idb.mjs`):
`server`, `folder` (File System Access), `opfs`, `idb`, `local` (localStorage).
All implement one contract; the library core is the only caller. Writes carry a
revision; stale writes conflict and merge by `updatedAt` with deletion tombstones,
announced over BroadcastChannel. Server mode keeps an offline mirror (read-only,
labeled) for when the companion is unreachable.

## Internal layering

```
UI (views, dialogs, keyboard, drag & drop)      no storage or network knowledge
  |
Library core (js/library.mjs)                   state, queries, mutations, debounced saves
  |
  +-- Storage adapters (js/storage.mjs)         server | local (folder/opfs/indexeddb later)
  +-- Item handlers (js/handlers/*)             video | link (audio/image/article/pdf/note/file later)
  +-- Enrichers                                 companion /api/enrich now; extension later
```

Rules:

- The UI never touches storage or `fetch` for metadata directly; it calls the
  library core, which calls adapters and enrichers.
- Everything optional is detected at runtime and degrades gracefully.
- ES modules (`.mjs`), no bundler, no build step. `app.js` is the browser entry
  (`<script type="module">`); it wires modules and boots. `i18n.js` stays a
  classic script so `player.html` can share it.
- Shared pure modules (`util`, `providers`, `schema`, `migrations`) are
  DOM-free at import time and unit-tested in Node (`test/unit.test.js`).

## Module map (browser)

| Module | Role |
| --- | --- |
| `app.js` | entry: wiring, backend probe, boot, view/group prefs, dev hook |
| `js/util.mjs` | pure helpers (time, URLs, escaping, canvas frames) |
| `js/providers.mjs` | 13 provider parsers, detection, title cleanup |
| `js/schema.mjs` | universal v2 schema, ids, path validation, legacy mapping |
| `js/migrations.mjs` | ordered idempotent migrations |
| `js/storage.mjs` | Storage contract + server/local adapters |
| `js/library.mjs` | core state, queries, mutations, save queue |
| `js/handlers/registry.mjs` | handler registration, type detection, labels |
| `js/handlers/video.mjs` | playback sources, frame access, embed URLs |
| `js/handlers/link.mjs` | generic URL fallback |
| `js/views.mjs` | grid/list cards, filter bars, empty states |
| `js/lightbox.mjs` | unified player host |
| `js/dialogs.mjs` | add / edit / move dialogs |
| `js/thumbpicker.mjs` | frame capture + image covers |
| `js/folders.mjs` | folder ops, selection, organize controls |
| `js/dnd.mjs` | card→folder drag, file/link drop |
| `js/keyboard.mjs` | shortcuts |
| `js/auto.mjs` | opening-frame covers, duration backfill |
| `js/ui.mjs` | toasts, confirm, locale dates |

## Server

`server.js` (CommonJS, Node built-ins only) + `lib/store.js` (universal
persistence: load/migrate/backup/atomic-write/quarantine). The legacy
`/api/videos*`, `/api/folders*`, `/api/state` routes remain as a compatibility
surface over the universal store; new clients use `/api/library` (whole-library
GET/PUT) plus `/api/items*`, `/api/files`, `/api/backups`. See `docs/api.md`.

Static serving is an allowlist: the UI files, `js/`, and the media folders
(`thumbnails/`, `videos/`, `files/`). The library JSON and repo internals are
never served. Symlinks out of the allowed roots are refused; `nosniff` is set;
generic files download with `Content-Disposition: attachment`.

## Honest limits

- ES modules do not load from `file://` (browser CORS). Double-clicking
  `index.html` no longer boots the app; use the hosted demo, any static server,
  or `node server.js`. Browser-only storage mode still works over plain HTTP.
- Cross-origin embeds cannot expose frames or playback time; covers come from
  provider stills or uploads, and durations from page metadata when exposed.
