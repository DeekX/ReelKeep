# Deploying the companion server

The server is safe on loopback by default. Anything beyond that needs a
password (`REELKEEP_PASSWORD`); a non-loopback bind without one **refuses to
start** unless you explicitly set `REELKEEP_ALLOW_INSECURE=1` (loud warning).

## Docker

```sh
REELKEEP_PASSWORD='a-long-random-string' docker compose up -d
```

- Pinned Node LTS base (`node:22.11.0-alpine3.20`), runs as a non-root user.
- Library, media and backups live in the `reelkeep-data` volume (`/data`).
- Healthcheck hits `/api/session`; the port is published on loopback only —
  put a reverse proxy with TLS in front for LAN/remote access.

## Reverse proxy examples

### Caddy

```caddyfile
library.example.com {
    reverse_proxy 127.0.0.1:5178
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name library.example.com;
    # ssl_certificate / ssl_certificate_key ...

    client_max_body_size 2048m;   # uploads (MAX_UPLOAD_MB)
    proxy_read_timeout 300s;      # long media streams

    location / {
        proxy_pass http://127.0.0.1:5178;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

With a proxy, keep `HOST=127.0.0.1` on the server itself and set
`REELKEEP_PASSWORD`; the session cookie is `HttpOnly; SameSite=Strict`, so
serve the app over HTTPS at the proxy.

## Single-file binaries

Each GitHub Release attaches `reelkeep-linux-x64`, `reelkeep-macos-arm64`,
`reelkeep-windows-x64` (+ `.sha256` checksums), built with Node's single
executable application support in CI (`.github/workflows/release.yml`).

```sh
sha256sum -c reelkeep-linux-x64.sha256
REELKEEP_PASSWORD='...' ./reelkeep-linux-x64     # library in ./data next to cwd
```

The binary embeds the app; user data lives in `REELKEEP_DATA` (default: the
working directory). Verify checksums before running.

**Honest OS warnings:** macOS Gatekeeper shows "unidentified developer" for
unsigned binaries — right-click → Open, or `xattr -d com.apple.quarantine
<file>` if you trust the source. Windows SmartScreen shows a similar prompt
for unsigned executables — "More info → Run anyway". Releases are unsigned
by design (no paid certificates); the checksums and public CI build are the
trust anchor.

## Environment reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `5178` | listen port (`0` = pick free) |
| `HOST` | `127.0.0.1` | bind address; non-loopback requires a password |
| `REELKEEP_PASSWORD` | unset | enables password auth (login cookie session) |
| `REELKEEP_ALLOW_INSECURE` | unset | `1` = allow non-loopback without password (warns) |
| `REELKEEP_DATA` | cwd (SEA) / app dir | where `data/`, `thumbnails/`, `videos/`, `files/`, `backups/` live |
| `MAX_UPLOAD_MB` | `2048` | upload cap |
| `MAX_MEDIA_MB` | `4096` | `/media` proxy stream cap |
