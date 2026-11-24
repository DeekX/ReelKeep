# HTTP API reference

The server (`server.js`) exposes a small JSON API plus static files. All
endpoints are same-origin by design; CORS headers are permissive so the
gallery also works when opened from another origin against a running server.

Errors are JSON: `{ "error": "message" }` with status `400`, `404`, `409`,
`413`, `415` or `502`.

## Auth (when `REELKEEP_PASSWORD` is set)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/session` | — | `{ required, authenticated }` |
| POST | `/api/login` | `{ password }` | `200 { ok }` + `Set-Cookie: rk_session=…; HttpOnly; SameSite=Strict`; `401` wrong; `429` rate-limited |
| POST | `/api/logout` | — | clears the cookie |

All other `/api/*` and `/media` requests return `401` without a valid session
cookie. The UI shell stays public so the login dialog can load. See
[deploy.md](deploy.md) for the full environment reference.

## Universal library (v2, current clients)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/library` | — | `{ library, readOnly }` — full schema-v2 library (see [data-format.md](data-format.md)); legacy files are migrated on load with a backup |
| PUT | `/api/library` | whole library | `200 { ok }` — validated, atomic write; `409` if the payload's schemaVersion is newer than the server understands |
| POST | `/api/items` | universal item | `201 { item }` — server assigns `id`/`createdAt` when absent |
| PATCH | `/api/items/:id` | partial item (`data` merged shallowly) | `200 { item }` — `id` cannot change |
| DELETE | `/api/items/:id` | — | `200 { ok }` — removes a stored cover in `thumbnails/` |
| POST | `/api/items/move` | `{ ids, folderId }` (`''`/null = unfiled) | `200 { moved }` |
| POST | `/api/files` | `?dir=files\|videos\|thumbnails`, raw bytes, `X-File-Name` | `201 { path, size, mime }` — content-sniffed; web-executable kinds refused; caps per dir |
| DELETE | `/api/files` | `?path=thumbnails/…\|videos/…\|files/…` | `200 { ok }` — traversal-checked |
| POST | `/api/snapshot` | `{ url }` | `{ url, title, blocks: [{tag, text}], readingTimeMin }` — opt-in reader copy; text only, SSRF-guarded |
| GET | `/api/backups` | — | `{ backups: [{ name, size, modifiedAt }] }` |
| POST | `/api/backups` | `{ reason }` | `201 { name }` — rolling backup of the library file |

## Legacy v1 compatibility (kept for old clients and tests)

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/state` | — | `{ version, videos: [...], folders: [...] }` |
| POST | `/api/videos` | video record (see below) | `201 { video }` — server assigns `id`, `addedAt` |
| PATCH | `/api/videos/:id` | partial record | `200 { video }` — `id` cannot change |
| DELETE | `/api/videos/:id` | — | `200 { ok: true }` — also removes a stored cover in `thumbnails/`, never the uploaded video |
| POST | `/api/videos/move` | `{ ids: [...], folderId }` (`''` = unfiled) | `200 { moved }` — one atomic write for the whole batch |

## Folders

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/folders` | `{ name }` (trimmed, ≤ 60 chars) | `201 { folder }` — `{ id, name, createdAt }` |
| PATCH | `/api/folders/:id` | `{ name }` | `200 { folder }` |
| DELETE | `/api/folders/:id` | — | `200 { ok: true, deleted }` — deletes the folder **and its member videos** (stored covers removed; uploaded files stay on disk). To keep the videos, move them out first via `/api/videos/move` with `folderId: ''` |

## Media and covers

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| POST | `/api/videos/upload` | raw file bytes, `X-File-Name` header (URL-encoded) | `201 { fileUrl, fileName, size }` — stored in `videos/`, media extensions only, capped by `MAX_UPLOAD_MB` (default 2048) |
| POST | `/api/thumbnails` | `{ dataUrl }` (`data:image/png\|jpeg\|webp\|gif;base64,…`) | `201 { thumbnail }` — relative path in `thumbnails/` |
| POST | `/api/thumbnails/from-url` | `{ url, referer? }` | `201 { thumbnail }` — copies a remote image locally; `image/*` only, ≤ 15 MB |
| GET | `/api/enrich` | `?url=<http(s) page>` | page metadata: `pageUrl`, `title`, `image`, `favicon`, `siteName`, `mediaUrl` (direct video file if the page exposes one), `embedPageUrl`, `isVideoPage`, `direct` |
| GET | `/media` | `?url=<http(s) media>&ref=<referer>` | byte-range proxy stream of the remote file, so `<video>` can seek and canvas can read frames |

## Static files

Only these are served: `/` (`index.html`), `/player.html`, `/app.js`,
`/styles.css`, `/i18n.js`, anything under `/js/` (ES modules), and anything
under `/thumbnails/`, `/videos/` and `/files/`.
Video responses support `Range` requests (`206` + `Content-Range`).
Symlinks out of the allowed roots are refused; `X-Content-Type-Options: nosniff`
is set; files under `/files/` download with `Content-Disposition: attachment`.
Everything else — including `data/library.json`, `data/videos.json`, `backups/`
and repository internals — returns `404`.

## Legacy video record (v1)

The universal item schema is documented in [data-format.md](data-format.md).
The legacy routes below accept and return this v1 shape; the server maps it
losslessly to/from universal items (`js/schema.mjs`).

```jsonc
{
  "id": "v_1a2b3c4d5e6f",   // server-assigned
  "title": "…",
  "url": "https://…",       // original page, or /videos/… for uploads
  "kind": "embed",          // embed | file | page
  "provider": "youtube",    // provider key, "file", "page" or "custom"
  "videoId": "aqz-KE-bpKQ", // provider-specific id, else null
  "embedUrl": "",           // manual player-URL override
  "fileUrl": "",            // direct media source, if any
  "folderId": "",           // folder id, or '' when unfiled
  "tags": ["…"],
  "notes": "…",
  "startAt": 0,             // seconds; playback start point
  "thumbnail": "",          // thumbnails/… path, http(s) URL or data: URL
  "thumbSource": "auto",    // auto | provider | page-image | frame | upload | url
  "thumbTime": null,        // seconds of the captured frame, if any
  "favicon": "",
  "site": "YouTube",
  "duration": 635,          // seconds, filled in by the player when known
  "addedAt": "2026-11-20T18:32:00.000Z",
  "lastOpenedAt": null
}
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5178` | listen port (`0` picks a free one; the actual port is logged) |
| `HOST` | `127.0.0.1` | bind address; `0.0.0.0` exposes the server to your LAN — read [SECURITY.md](../SECURITY.md) first |
| `MAX_UPLOAD_MB` | `2048` | upload size cap in megabytes |
