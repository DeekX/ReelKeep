# ReelKeep code audit — Phase 0 (2026-11-24)

Snapshot of what actually exists at `831e44a` (v1.5.0 + Pages fix), before the
universal-library roadmap work. The roadmap is the destination; this file is the
truth about today. Verified by reading every source file and running the suite.

## Test baseline

- `npm test` (`node --test`, Node v22.23.4, Windows): **9 tests, 9 pass, 0 fail**
  (~0.55 s). Suite boots a real server in a temp dir.
- CI (`.github/workflows/ci.yml`): matrix ubuntu/macos/windows × Node 18/20/22,
  runs `node --check server.js` + `npm test`. Last remotely verified green at
  `c7a7a6c` (v1.5.0); `831e44a` only changes `pages.yml`, which CI does not run.
  No `gh` CLI on the dev machine, so remote status at HEAD is unverified.

## Module map

| File | Lines | Role |
| --- | --- | --- |
| `server.js` | 633 | CommonJS, zero deps. Static allowlist, JSON store, folder/video CRUD, uploads, thumbnails, page enrich, media proxy. Starts listening on require (not importable for unit tests). |
| `app.js` | 2005 | Classic script (not a module). Helpers, 13 provider parsers, state, `store` (remote/localStorage switch), template-string rendering, lightbox, add/edit/thumbnail/move/confirm dialogs, folders/selection/drag, keyboard, boot. |
| `i18n.js` | 2188 | Classic script. 11 locale dictionaries (`en` base + `I18N_EXTRA` merged), `t()`, `applyI18n()`, `setLocale()`, `i18nInit()`. Globals consumed by `app.js` and `player.html`. |
| `index.html` | 427 | All markup: icon sprite, topbar, library head, folder/tag bars, grid, empty state, dropzone, 6 dialogs, footer. Loads `i18n.js` + `app.js` with `defer`. |
| `player.html` | 64 | In-iframe native `<video>` player for file sources; `postMessage({from:'vg-player',…}, '*')` to parent (time/meta/error). |
| `styles.css` | 750 | Screening-room identity: warm-grey dark palette, broadcast-blue `#58a6ff`, mono slates, 8/6/12px corners, hairlines, 120ms colour-only motion, RTL logical properties, reduced-motion. Dark only — no light theme. |
| `test/server.test.js` | 189 | 9 HTTP smoke tests (CJS, `node:test`). |
| `scripts/screenshot.mjs` | — | Dev-only headless-Chrome screenshot tool (Node 22+). |
| `data/videos.example.json` | — | Seed library: 5 videos, 2 folders. Copied to `data/videos.json` on first run; fetched by browser-only mode on first visit. |

## Data flow

```
boot(): probe GET /api/state
  ok  → backend 'remote' → store.load() → GET /api/state
  err → backend 'local'  → localStorage['video-gallery.v1']
        (first visit: fetch data/videos.example.json, seed localStorage)
state.videos / state.folders  ←→  render() → #grid innerHTML (escaped templates)
every mutation → store.* → remote: /api/* JSON routes → readDb/writeDb
                          → local:  read/modify/write whole localStorage blob
uploads: XHR POST /api/videos/upload (raw bytes, X-File-Name) → videos/<generated>
covers:  POST /api/thumbnails (dataURL) | /api/thumbnails/from-url (copy) → thumbnails/<generated>
player:  iframe src = provider embed URL | /player.html?src=… | page URL
         /player.html posts time back → "remember this time" writes startAt
enrich:  GET /api/enrich?url=… (add dialog debounce 550ms; boot backfill 2 workers)
```

### Storage today

- File: `data/videos.json`, shape `{ version: 1, videos: [...], folders: [...] }`.
- `readDb()`: JSON.parse; on any error renames file to `videos.json.corrupt-<ts>`
  and returns an empty library (no backup restore, no prompt).
- `writeDb()`: serialized promise queue → write `videos.json.<pid>.tmp` → rename
  (atomic). Errors only `console.error` — **swallowed**, caller sees success.
- No schema version beyond `version: 1`, no migrations, no rolling backups, no
  trash. Browser fallback keeps the same shape in one localStorage key; quota
  errors surface as a toast only.
- Video record schema: see `docs/api.md` (id `v_…`, kind embed/file/page,
  provider, videoId, embedUrl, fileUrl, folderId, tags, notes, startAt,
  thumbnail, thumbSource, thumbTime, favicon, site, duration, addedAt,
  lastOpenedAt).

## Every API route (server.js)

| Route | Method | Notes |
| --- | --- | --- |
| `/api/state` | GET | `{version:1, videos, folders}` |
| `/api/folders` | POST | name trimmed ≤60 chars; id `f_…` |
| `/api/folders/:id` | PATCH, DELETE | DELETE also deletes member videos + their stored covers |
| `/api/videos/move` | POST | `{ids, folderId}` batch, one write |
| `/api/videos` | POST | spreads body, assigns `id`, `addedAt`, `lastOpenedAt:null` |
| `/api/videos/:id` | PATCH, DELETE | PATCH spreads body over record (id pinned); DELETE removes stored cover |
| `/api/videos/upload` | POST | raw stream → `videos/`, extension allowlist (else `.mp4`), generated name, `MAX_UPLOAD_MB` cap (default 2048) |
| `/api/thumbnails` | POST | dataURL `image/(png\|jpeg\|webp\|gif)` only → `thumbnails/` |
| `/api/thumbnails/from-url` | POST | fetch remote image, `image/*` + ≤15 MB checks |
| `/api/enrich` | GET | `?url=` http(s) only; page metadata + duration parsing |
| `/media` | GET | `?url=&ref=` byte-range proxy stream |
| static | GET | allowlist: `index.html`, `player.html`, `app.js`, `styles.css`, `i18n.js` + anything inside `thumbnails/`, `videos/`. Range support. Everything else 404. |

All `/api/*` + `/media` responses set `Access-Control-Allow-Origin: *` and answer
OPTIONS 204. **No CSRF/origin checks, no auth, no security headers, no CSP.**

## Every place data is read or written

- Server: `readDb`/`writeDb` (all routes), first-run seed copy, corrupt quarantine
  rename, `saveUpload` stream, thumbnail writes (2 routes), cover deletes on
  video/folder DELETE, `serveStatic` reads.
- Browser: `localStorage` keys `video-gallery.v1` (library), `video-gallery.view`,
  `video-gallery.group`, `reelkeep.lang`; `store.*` fetches; XHR upload;
  FileReader dataURLs; canvas frame capture.

## Every place remote URLs are fetched

- Server: `enrich()` (page HTML, ≤2 MB read, 12 s timeout, consent cookies),
  Vimeo oEmbed fallback, `proxyMedia()` (**no timeout, no size cap**),
  `/api/thumbnails/from-url` (12 s timeout, 15 MB cap).
- Browser: provider iframes (YouTube/Vimeo/… embed URLs), `<img>` covers
  (provider thumbs, `og:image` hotlinks until copied, favicons
  `https://<host>/favicon.ico`), `/player.html` video src (remote direct files
  played straight in browser-only mode), `data/videos.example.json` (same-origin).
- **SSRF posture today:** only `http(s)` scheme checks. No DNS resolution, no
  private-range blocking, no redirect re-validation. Documented as a LAN-mode
  trade-off in SECURITY.md; the roadmap makes it a hard requirement.

## Known bugs and gaps (found by reading, not yet fixed)

1. **Stored-XSS via thumbnail extension** — `/api/thumbnails/from-url` derives the
   saved extension from the URL path, not the content type. An attacker server
   can return `Content-Type: image/png` with an HTML body at a URL ending `.html`;
   the file is saved `thumbnails/<ts>_<rand>.html` and served as `text/html` from
   the app origin. Fix: extension from content type only.
2. **Drive-by API writes** — CORS `*` + no CSRF/origin check: any website can
   create/delete videos on a running loopback server.
3. **Symlink escape** — `inside()` compares path strings, not realpaths; a symlink
   inside `thumbnails/`/`videos/` pointing outside is served.
4. **Write errors swallowed** — `writeDb` catch only logs; UI believes save succeeded.
5. **Corrupt library** — quarantined but never restored from backup; user silently
   gets an empty library. The recovery envelope also lacks `folders` entirely
   (pinned by the characterization suite).
6. **`new URL(req.url, …)` outside try** — a malformed Host header can throw before
   the route try/catch (hangs the request; caught only by the global handler).
7. **Duplicate header key** — `enrich()` fetch headers define `Accept-Language`
   twice (second wins). Cosmetic.
8. **i18n gaps** — card action titles `"Edit / rename"` / `"Delete"`, preview
   strings `"auto"` / `"no thumbnail"` are hard-coded English.
9. **Branding drift** — UI/README title "Reelkeep" vs repo "ReelKeep"; favicon and
   demo badge still use the retired indigo `#5e6ad2`.
10. **`postMessage(…, '*')`** in player.html — playback time readable by any
    embedder; needs an origin allowlist.
11. **`startAt` conflated with progress** — "remember this time" overwrites the
    explicit start point; roadmap separates `progress` (resume) from `startAt`.
12. **No content sniffing on upload** — extension allowlist only.
13. **Whole-grid re-render** on every change; no search index; chunked "Load more"
    only. Fine at hundreds, untested at 10 000.
14. **Dark theme only**; no `prefers-color-scheme`, no manual override.
15. **No key-parity test** for the 11 dictionaries; no `?` help overlay; no
    light theme; no PWA; no trash/backups/importers/exporters.
16. **Twitch embeds broken** (found by the new characterization tests): Twitch's
    `parse()` returned `kind:'vods'`/`'clip'`, which `detect()` spread over
    `kind:'embed'`. `frameSrc()` then skipped the provider-embed branch and
    loaded the raw twitch.tv page (which refuses framing). Fixed in the Phase 1
    module split; migration normalizes existing records.

## Phase 1 outcome (2026-11-24)

Bugs 1–8 and 16 above are fixed; 9 (branding) standardized. The module split,
universal schema, migrations, storage interface and handlers landed (v1.6.0).
New honest limit introduced by the ES-module split: browsers refuse modules
over `file://`, so the double-click fallback is gone (documented in README and
architecture.md); browser-only mode works over any static host. Remaining
audit items (SSRF, CSRF, auth, headers, perf, trash, importers…) are scheduled
in Phases 2–6 per ROADMAP.md.

## What the roadmap can skip (already done)

Zero runtime deps; atomic writes + write queue; static allowlist; loopback
default; corrupt-file quarantine; upload extension allowlist + generated names;
11-language i18n runtime with RTL; CI matrix (3 OS × Node 18/20/22); issue/PR
templates; CONTRIBUTING/SECURITY/CHANGELOG/LICENSE; Keep-a-Changelog format;
product-style README; chunked rendering; keyboard shortcuts (partial); demo
deploy workflow; example seed library.
