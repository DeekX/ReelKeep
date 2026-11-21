# Contributing to Reelkeep

Thanks for considering a contribution. Reelkeep is a small, deliberately
dependency-free project — please keep it that way.

## Ground rules

- **Zero runtime dependencies.** The server uses only Node built-ins; the UI is
  vanilla HTML/CSS/JS. No build step, no bundler, no framework, no `npm install`.
- **Node 18+** is the supported floor (`engines` in package.json). Test against
  it if you can; CI runs 18, 20 and 22 on Linux, macOS and Windows.
- **Plain JSON stays the source of truth.** `data/videos.json` must remain
  hand-editable and version-controllable. Never introduce a database or a
  binary format.
- **Local-first, loopback by default.** Anything that changes the network
  surface (new endpoints, new fetches) needs a note in SECURITY.md and the
  README.

## Setup

```sh
git clone https://github.com/DeekX/ReelKeep.git
cd reelkeep
node server.js        # http://127.0.0.1:5178
```

There is nothing to install. `npm start` is an alias for `node server.js`.

## Tests

```sh
npm test              # node:test smoke suite, no dependencies
```

The suite boots a real server in a temporary directory and exercises seeding,
CRUD, uploads, range requests, thumbnail storage, the static-file allowlist and
corrupt-library recovery. Add a test for every behaviour change; bug fixes
should start with a failing test.

## Refreshing the README screenshots

With the server running and Chrome (or Chromium/Edge) installed:

```sh
npm run screenshot    # needs Node 22+; writes docs/screenshot-*.png
```

Set `CHROME_PATH` if your browser lives somewhere unusual, and `REELKEEP_URL`
if the server is not on port 5178.

## Style

- Match the surrounding code: small functions, no classes where a closure
  reads better, comments only for non-obvious constraints.
- UI: restrained dark palette, one accent colour, hierarchy through type and
  spacing. No gradients, glassmorphism or emoji in the interface.
- Commits follow the existing history: `feat:`, `fix:`, `docs:`, `chore:`,
  `test:` prefixes, imperative subject, body explains *why* when it isn't
  obvious.

## Pull requests

1. Fork and branch from `main`.
2. Keep the change focused; one concern per PR.
3. `npm test` green, and `node --check server.js app.js` clean.
4. Describe what you changed, why, and how you verified it (OS + Node version).
   Screenshots help for UI changes.

## Reporting bugs and ideas

Use the issue templates. For anything security-sensitive, follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.
