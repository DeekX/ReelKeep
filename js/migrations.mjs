/* ReelKeep migration framework — pure, ordered, idempotent.
   Backups are the storage adapter's job (before any migrated write);
   the legacy file is never deleted here. */

import { SCHEMA_VERSION, emptyLibrary, legacyToItem } from './schema.mjs';

/** v1 {version, videos, folders} → v2 universal library. Lossless: every v1
    field maps to the envelope or data; unknown fields are preserved. */
function v1to2(data, { now }) {
  const lib = emptyLibrary(now);
  lib.folders = (data.folders || []).map((f, i) => {
    const folder = { id: f.id, name: f.name, createdAt: f.createdAt || now, order: i };
    for (const [k, val] of Object.entries(f)) if (!(k in folder)) folder[k] = val;
    return folder;
  });
  lib.items = (data.videos || []).map((v) => legacyToItem(v, { now }));
  for (const [k, val] of Object.entries(data)) {
    if (k !== 'version' && k !== 'videos' && k !== 'folders' && !(k in lib)) lib[k] = val;
  }
  return lib;
}

export const MIGRATIONS = [{ to: 2, up: v1to2 }];

export function detectVersion(raw) {
  if (raw && typeof raw.schemaVersion === 'number') return raw.schemaVersion;
  if (raw && Array.isArray(raw.videos)) return 1;
  return null;
}

/**
 * Returns { data, fromVersion, changed, readOnly }.
 * - idempotent: migrating an already-current library returns it unchanged
 * - newer-than-supported libraries come back readOnly, never rewritten
 * - `now` is injectable so tests are deterministic
 */
export function migrateLibrary(raw, { now = new Date().toISOString() } = {}) {
  const version = detectVersion(raw);
  if (version == null) return { data: raw, fromVersion: null, changed: false, readOnly: false, invalid: true };
  if (version > SCHEMA_VERSION) return { data: raw, fromVersion: version, changed: false, readOnly: true };
  let data = raw;
  for (const m of MIGRATIONS) {
    if (detectVersion(data) < m.to) data = m.up(data, { now });
  }
  return { data, fromVersion: version, changed: version !== SCHEMA_VERSION, readOnly: false };
}
