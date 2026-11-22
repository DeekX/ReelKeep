# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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

### Added
- `docs/screenshot-list.png` and a list-view capture step in `scripts/screenshot.mjs`.

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
