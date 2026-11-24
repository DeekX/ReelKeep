# ReelKeep data format (schema v2)

The library is one plain JSON file: `data/library.json` (server mode) or a
localStorage blob (browser-only mode). Human-readable, hand-editable,
version-controllable. **Unknown fields are preserved** on load and save so a
newer version's data is never destroyed by an older one.

Legacy `data/videos.json` (schema v1) is still read. On first load it is
migrated to `library.json` automatically, with a backup in `backups/`
(`videos-<timestamp>.json`). The legacy file is **never deleted or rewritten**.

## Envelope

```jsonc
{
  "schemaVersion": 2,
  "meta": { "createdAt": "ISO-8601", "app": "reelkeep", "appVersion": "x.y.z" },
  "folders": [
    { "id": "f_xxxxxxxx", "name": "Watch later", "createdAt": "ISO-8601", "order": 0 }
  ],
  "items": [ /* universal items, below */ ]
}
```

## Universal item

```jsonc
{
  "id": "i_xxxxxxxxxxxx",          // stable, random, never reused (legacy v_… ids kept)
  "type": "video",                 // video | audio | image | article | link | pdf | note | file
  "title": "string",
  "url": "https://… or /videos/… or null",
  "source": { "name": "YouTube", "domain": "youtube.com" },
  "folderId": "f_xxxxxxxx or null",
  "tags": ["tag1", "tag2"],
  "notes": "string",
  "cover": { "kind": "file|url|none", "path": "thumbnails/i_xxx.jpg", "origin": "auto|frame|upload|url" },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "lastOpenedAt": "ISO-8601 or null",
  "openCount": 0,
  "pinned": false,
  "data": { /* type-specific, below */ }
}
```

Rules:

- IDs are random (`crypto.randomUUID()`-derived), never derived from content.
- Times are ISO-8601 UTC strings.
- Paths are relative to the library root, forward slashes, validated against
  traversal (`..`, absolute paths, drive letters) on read and write.
- One folder per item; tags cover everything else.
- A library with a **newer** `schemaVersion` opens read-only; it is never
  downgraded or rewritten.

## Type-specific `data`

| Type | Fields |
| --- | --- |
| video | `kind` (embed/file/page), `provider`, `videoId`, `playerUrl` (embed override), `fileUrl`, `startAt` (s), `progress` (s, resume), `duration` (s), `favicon`, `thumbSource`, `thumbTime` |
| link | `description` |
| audio, image, article, pdf, note, file | arrive in Phase 2 (see ROADMAP.md) |

The video fields `kind/provider/videoId/playerUrl/fileUrl/startAt/duration/
favicon/thumbSource/thumbTime` are exactly the v1 record's playback fields, so
the migration is lossless and the legacy API can reconstruct v1 records
byte-for-byte (see `js/schema.mjs`: `legacyToItem` / `itemToLegacy` /
`applyLegacyPatch`).

## Migrations

`js/migrations.mjs` holds ordered, pure, idempotent migrations
(`(oldData) -> newData`, registered with a target version). They run on load in
both the browser and the server. Before any migrated write, the storage layer
copies the current file to `backups/` (never overwriting an existing backup).
Required tests live in `test/unit.test.js` (golden fixture losslessness,
double-run idempotency, future-version read-only) and
`test/migration-server.test.js` (backup, legacy preservation, restart).

## Storage adapters

Every backend implements the same contract (`js/storage.mjs`): `open`,
`readLibrary`, `writeLibrary`, `putFile`, `getFile`, `getFileUrl`, `deleteFile`,
`createBackup`, `listBackups` (+ optional `enrichUrl`). The library core
(`js/library.mjs`) is the only caller; it serializes writes, debounces saves
(~300 ms) and flushes on `pagehide`/`visibilitychange`. Phase 1 ships `server`
and `local` (localStorage); folder / OPFS / IndexedDB adapters arrive in Phase 3.
