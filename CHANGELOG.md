# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [1.1.0] - 2026-11-21

### Added
- Live browser demo on GitHub Pages, seeded with the example library
  (`https://deekx.github.io/reelkeep/`).
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
