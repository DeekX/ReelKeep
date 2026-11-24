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

## Network fetches (SSRF defense)

Every server-side fetch of a user-supplied URL (`/api/enrich`, `/media`,
`/api/thumbnails/from-url`, `/api/snapshot`) goes through `lib/ssrf.js` +
`lib/safefetch.js`:

- only `http`/`https`;
- the hostname is resolved and loopback, link-local, RFC 1918, CGNAT,
  multicast, unique-local and metadata ranges are blocked (IPv4, IPv6 and
  IPv4-mapped IPv6);
- the connection is pinned to the validated IP, and every redirect hop is
  re-validated (redirects capped);
- timeouts, response-size caps and content-type expectations are enforced.

`test/security.test.js` covers these cases and runs in CI.

## Writes (CSRF)

Any website can reach a loopback server, so state-changing API requests are
refused when their `Origin` does not match the request `Host`. Non-browser
clients (curl, tests) send no `Origin` and remain allowed.

## Authentication

Set `REELKEEP_PASSWORD` to require a password: constant-time comparison,
HMAC-signed `HttpOnly; SameSite=Strict` session cookie (30 days), per-IP login
rate limiting (8 failures / 15 min). A non-loopback `HOST` without a password
refuses startup unless `REELKEEP_ALLOW_INSECURE=1` is set explicitly (loud
warning). Without a password on loopback, the server remains a personal,
single-user tool.

## Headers

HTML responses carry a tight CSP (`script-src 'self'`; no inline scripts),
`X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a minimal
`Permissions-Policy`, and `X-Frame-Options: SAMEORIGIN`.

## Content handling

- Uploads are content-sniffed as well as extension-checked; HTML/script/web-
  executable kinds are refused. Stored names are generated, never user-supplied.
- Files under `files/` download with `Content-Disposition: attachment` and
  `nosniff`; `?inline=1` is honored only for viewer-safe kinds (PDF, image,
  media) and never for web content.
- PDFs open in a sandboxed iframe (`allow-scripts allow-same-origin allow-popups
  allow-downloads`); nothing from the file runs in the app origin.
- Reader snapshots are stored as **text blocks only** and rendered by DOM
  construction; Markdown notes use a minimal allowlisted renderer (links:
  http/https/mailto, `rel="noopener noreferrer"`). No fetched or typed HTML ever
  reaches `innerHTML`.
- Provider video iframes are loaded without a sandbox so real players (YouTube,
  Vimeo, …) keep working. Only add links you trust.

## Known trade-offs (read before exposing to a LAN)

- With `HOST=0.0.0.0`, anyone on your network can use the library and make the
  server fetch public hosts on their behalf (internal targets stay blocked).
  Only enable LAN mode on networks you trust.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting:
<https://github.com/DeekX/ReelKeep/security/advisories/new>

Include reproduction steps and impact. You can expect an acknowledgement
within a few days; fixes ship as patch releases with credit unless you prefer
otherwise.

## Supported versions

Only the latest release on `main` receives security fixes.
