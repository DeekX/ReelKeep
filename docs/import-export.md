# Import & export

## Export (toolbar → Export)

| Format | Contents | Use |
| --- | --- | --- |
| JSON | full-fidelity library (`schemaVersion`, folders, items, unknown fields); browser-only mode inlines stored files ≤ 8 MB total | backup, migration, round-trip |
| CSV | id, type, title, url, folder, tags, notes, dates | spreadsheets |
| HTML bookmarks | Netscape format with folders as `<H3>` and tags | any browser / bookmark manager |

Server mode: your media already lives in `thumbnails/`, `videos/`, `files/`
next to `data/library.json` — the folder **is** the export bundle. Copy it and
you have everything.

## Import (toolbar → Import)

Accepted: ReelKeep JSON, browser bookmarks HTML (Netscape), Raindrop CSV,
Pocket (HTML or JSON), Karakeep JSON, Linkwarden JSON, YouTube Takeout playlist
JSON, plain URL lists (`title | url` lines supported).

Every import:

1. **Previews** — format, item count, new vs duplicates (normalized URL:
   scheme/host lowercased, no `www`/hash/trailing slash, sorted query), type
   breakdown, and parse errors.
2. **Dedupes** — against the existing library and within the batch.
3. **Is undoable** — one batch, one undo (toast action), plus a rolling
   `pre-import` backup on the server.

Parsers are pure and hostile-input safe (`js/importers.mjs`): non-http schemes
skipped with a report, strings capped, malformed files produce errors instead
of exceptions. Fixtures + tests: `test/fixtures/`, `test/importers.test.js`.

## Round-trip guarantee

Export JSON → import into an empty library yields the same library
(`test/handlers.test.js` enforces it across all eight types). Bookmarks HTML
export → bookmarks import preserves titles, URLs, tags and folder names
(`test/scale.test.js`).
