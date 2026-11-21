# Security policy

## Scope and design posture

Reelkeep is a **personal, local-first tool**, not a hosted service:

- The server binds to `127.0.0.1` by default. Nothing is reachable from the
  network unless you opt in with `HOST=0.0.0.0`.
- Only the UI files (`index.html`, `player.html`, `app.js`, `styles.css`) and
  the `thumbnails/` and `videos/` folders are served over HTTP. The library
  JSON, server source and repository internals are never exposed.
- Uploads are stored under generated names with a media-only extension
  allowlist, so an uploaded file can never be served as HTML or script.
- The library file is written atomically (temp file + rename).

## Known trade-offs (read before exposing to a LAN)

- `/media` and `/api/enrich` fetch URLs supplied by the client. On a
  loopback-bound server this is the intended feature (playing remote files,
  reading page metadata). With `HOST=0.0.0.0`, anyone on your network can make
  the server issue requests to hosts they choose, including internal ones.
  Only enable LAN mode on networks you trust.
- Provider iframes are loaded without a sandbox so real players (YouTube,
  Vimeo, …) keep working. Only add links you trust.
- There is no authentication. LAN mode is sharing, not multi-tenant hosting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting:
<https://github.com/DeekX/reelkeep/security/advisories/new>

Include reproduction steps and impact. You can expect an acknowledgement
within a few days; fixes ship as patch releases with credit unless you prefer
otherwise.

## Supported versions

Only the latest release on `main` receives security fixes.
