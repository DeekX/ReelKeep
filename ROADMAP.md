# ReelKeep roadmap

Public summary of the plan that shaped v2.x. Principles, in priority order:
zero runtime dependencies · local-first and user-owned · safe by default ·
honest limits · progressive power · fast and light · accessible and
international (11 languages, full RTL).

## Shipped

- **v1.6.0 — Foundations**: code audit (`docs/audit.md`), universal schema v2,
  tested idempotent migrations with backups, storage interface, ES-module
  split, item-handler registry.
- **v2.0.0 — Universal library**: article/link, image, audio, PDF, note and
  file types; type auto-detection; resume position; JSON export/import with
  preview + undo; SSRF/CSRF/upload-sniffing hardening.
- **v2.1.0 — Browser-only & PWA**: installable app with offline shell and safe
  updates; folder mode (Chrome/Edge); OPFS/IndexedDB fallback; multi-tab merge;
  offline mirror for server mode.
- **v2.2.0 — Extension**: MV3 one-click save, context menus, origin-pinned
  handoff, local queue; minimal permissions; privacy policy; store copy.
- **v2.3.0 — Companion hardening**: optional password auth, tight CSP and
  security headers, Docker (non-root, healthcheck), single-file binaries +
  checksums via release workflow.
- **v2.4.0 — Scale & portability**: indexed search + offscreen culling
  (10k-item benchmark in CI), importers (bookmarks, Raindrop, Pocket,
  Karakeep, Linkwarden, YouTube Takeout, URL lists), CSV/HTML exporters,
  rolling backups, trash with auto-purge, duplicate detection, smart views,
  opt-in link health check.

## Deferred (owner decision)

- **Archiving** (opt-in `yt-dlp`/`ffmpeg` integration, companion-only):
  deliberately not built yet. When it lands: user-installed binaries only,
  argument arrays, URL validation, explicit per-item action, terms notice.

## Non-goals

Cloud sync, accounts, hosted backend, social features, telemetry, heavy
frontend frameworks, bundled downloader binaries.

## How to influence this

Open an issue (templates provided). Translations: `docs/i18n-status.md` flags
machine-quality strings awaiting native review. Design work follows
`docs/ui-brief.md`; data changes follow `docs/data-format.md` and must ship
with migrations + tests.
