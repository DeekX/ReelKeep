# FAQ

**How is this different from a bookmark manager?**
Bookmarks are one item type here. ReelKeep keeps videos (with a real player and
frame-accurate covers), articles (with an optional local reader copy), images,
audio with remembered position, PDFs, Markdown notes and arbitrary files — in
one searchable library you own as plain files. No account, no quota, no cloud.

**How is this different from Pocket / Raindrop / Karakeep?**
Those are services (or self-hosted stacks with databases). ReelKeep is a
single dependency-free Node server or an installable browser app; your library
is a JSON file you can read, edit, diff and version-control. Importers accept
their exports so leaving them is easy.

**Where is my data?**
Server mode: `data/library.json` + `thumbnails/`, `videos/`, `files/`,
`backups/` next to it. Folder mode: the folder you picked. Browser mode:
OPFS/IndexedDB/localStorage inside your browser, exportable as JSON.

**Does anything leave my machine?**
Only requests you cause: playing remote media, fetching page metadata, copying
a cover, opt-in reader snapshots and opt-in link checks. No telemetry, no
analytics, no accounts. The extension queues saves locally when offline.

**Why can't I pick frames from YouTube?**
Browsers forbid reading pixels from cross-origin iframes. Uploaded files and
direct media URLs (proxied same-origin) support frame picking; embeds get
provider stills, uploads or image URLs. This is a browser limit, not a bug.

**Why doesn't double-clicking index.html work anymore?**
The UI is ES modules; browsers block modules over `file://`. Use the hosted
demo, any static server, or `node server.js`.

**Is it safe to expose on my LAN?**
Set `REELKEEP_PASSWORD` first — non-loopback binds without a password refuse
to start. Then put TLS in front (see `docs/deploy.md`). SSRF defenses block
internal targets for every server-side fetch.

**What happens when I delete something?**
It moves to Trash (recoverable; auto-purge after 30 days by default).
"Delete forever" in Trash is permanent. Uploaded media files are never
deleted by library operations.

**Two tabs / two windows?**
Safe: revisions + BroadcastChannel merge edits; stale writes are refused and
merged, never overwritten.

**10,000 items?**
Supported and benchmarked: ~0.6 s boot, ~90 ms search (see
`docs/performance.md`).
