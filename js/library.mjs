/* ReelKeep library core — state, queries, mutations, persistence.
   The UI calls this module; this module calls the storage adapter.
   Saves are debounced whole-library writes, flushed on page hide. */

import { migrateLibrary } from './migrations.mjs';
import { emptyLibrary, nowIso, SCHEMA_VERSION, APP_VERSION, applyLegacyPatch, newId } from './schema.mjs';
import { debounce } from './util.mjs';
import { toast } from './ui.mjs';
import { getHandler, labelOf, sourceKeyOf } from './handlers/registry.mjs';

export const state = {
  items: [],
  folders: [],
  folder: 'all', // 'all' | 'unfiled' | folder id
  q: '',
  tokens: [],
  sort: 'added',
  provider: '',
  type: '',
  tags: new Set(),
  view: 'grid',
  group: false,
  selecting: false,
  selected: new Set(),
  limit: 60,
  backend: 'remote', // or 'local'
  current: null, // item open in the lightbox
  lastTime: 0,
  readOnly: false,
};

let storage = null;
let meta = null;
let onChange = () => {};

export const setOnChange = (fn) => (onChange = fn);
export const getStorage = () => storage;
export const byId = (id) => state.items.find((v) => v.id === id);

export async function initLibrary(st) {
  storage = st;
  await storage.open();
  const raw = await storage.readLibrary();
  const res = migrateLibrary(raw ?? emptyLibrary(), { now: nowIso() });
  if (res.invalid) {
    state.items = [];
    state.folders = [];
  } else {
    state.items = res.data.items || [];
    state.folders = res.data.folders || [];
    meta = res.data.meta || null;
  }
  state.readOnly = !!res.readOnly || !!storage.readOnly;
  if (res.changed && storage.id !== 'server') {
    // the server backs up its own migrations; browser storage backs up here
    await storage.createBackup('pre-migration').catch(() => {});
    await storage.writeLibrary(res.data);
  }
}

export function snapshot() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: meta || { createdAt: nowIso(), app: 'reelkeep', appVersion: APP_VERSION },
    folders: state.folders,
    items: state.items,
  };
}

const persist = debounce(async () => {
  if (!storage || state.readOnly) return;
  try {
    await storage.writeLibrary(snapshot());
  } catch (err) {
    toast(t('to.savefail', { err: err.message }), 'err', 6000);
    // roll back to what is actually stored rather than silently diverging
    try {
      const raw = await storage.readLibrary();
      const res = migrateLibrary(raw ?? emptyLibrary(), { now: nowIso() });
      state.items = res.data.items || [];
      state.folders = res.data.folders || [];
      onChange();
    } catch {
      /* storage unreachable — the error toast already told the user */
    }
  }
}, 300);

export function save() {
  if (state.readOnly) {
    toast(t('to.readonly'), 'err', 5000);
    return;
  }
  persist();
}

export async function flushSave() {
  persist.cancel();
  if (storage && !state.readOnly) await storage.writeLibrary(snapshot());
}

/* ------------------------------------------------------------ mutations */

/** v1-style patch for video items (legacy fields), universal merge otherwise. */
export function patch(id, data, rerender = true) {
  const item = byId(id);
  if (!item) return null;
  if (item.type === 'video') {
    applyLegacyPatch(item, data);
  } else {
    const { data: d, ...rest } = data;
    Object.assign(item, rest, { id: item.id });
    if (d) item.data = { ...item.data, ...d };
    item.updatedAt = nowIso();
  }
  save();
  if (rerender) onChange();
  return item;
}

export async function addItem(input) {
  const handler = getHandler(input.type || 'video') || getHandler('link');
  const item = await handler.create(input, {});
  state.items.unshift(item);
  save();
  onChange();
  return item;
}

export async function removeItem(id) {
  const item = byId(id);
  if (!item) return;
  if (item.cover?.kind === 'file' && /^thumbnails\//.test(item.cover.path || '') && storage) {
    await storage.deleteFile(item.cover.path).catch(() => {});
  }
  state.items = state.items.filter((v) => v.id !== id);
  state.selected.delete(id);
  save();
  onChange();
}

export function moveItems(ids, folderId) {
  const target = folderId || null;
  let moved = 0;
  state.items.forEach((v) => {
    if (ids.includes(v.id)) {
      v.folderId = target;
      moved++;
    }
  });
  ids.forEach((id) => state.selected.delete(id));
  save();
  onChange();
  return moved;
}

export function createFolder(name) {
  const folder = { id: newId('f'), name, createdAt: nowIso(), order: state.folders.length };
  state.folders.push(folder);
  save();
  onChange();
  return folder;
}

export function renameFolder(id, name) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return null;
  f.name = name;
  save();
  onChange();
  return f;
}

export async function removeFolder(id) {
  const gone = state.items.filter((v) => v.folderId === id);
  for (const v of gone) {
    if (v.cover?.kind === 'file' && /^thumbnails\//.test(v.cover.path || '') && storage) {
      await storage.deleteFile(v.cover.path).catch(() => {});
    }
  }
  state.folders = state.folders.filter((x) => x.id !== id);
  state.items = state.items.filter((v) => v.folderId !== id);
  gone.forEach((v) => state.selected.delete(v.id));
  if (state.folder === id) state.folder = 'all';
  save();
  onChange();
  return gone.length;
}

/** Page metadata via the active enricher (companion server now; extension later). */
export async function enrichUrl(url) {
  if (!storage?.enrichUrl) return null;
  return storage.enrichUrl(url);
}

/** Opt-in reader snapshot (companion enricher); text blocks, sanitized by construction. */
export async function snapshotUrl(url) {
  if (!storage?.snapshotUrl) throw new Error(t('st.localenrich'));
  return storage.snapshotUrl(url);
}

/** Copy a hotlinked cover into local storage; keeps the URL if the copy fails. */
export async function copyCover(url, referer) {
  if (!url || !/^https?:/i.test(url) || !storage?.copyImageFromUrl) return url;
  try {
    return await storage.copyImageFromUrl(url, referer);
  } catch (err) {
    toast(t('to.copyfail', { err: err.message }), 'err', 5000);
    return url;
  }
}

/* -------------------------------------------------------------- queries */

export function matches(item, tokens) {
  if (!tokens.length) return true;
  const extra = getHandler(item.type)?.searchText?.(item) || '';
  const hay = [item.title, item.notes, item.url, labelOf(item), extra, ...(item.tags || [])].join(' ').toLowerCase();
  return tokens.every((tok) => hay.includes(tok));
}

export function visibleItems() {
  const tokens = state.tokens;
  const list = state.items.filter((v) => {
    if (state.folder === 'unfiled' && v.folderId) return false;
    if (state.folder !== 'all' && state.folder !== 'unfiled' && v.folderId !== state.folder) return false;
    if (state.provider && sourceKeyOf(v) !== state.provider) return false;
    if (state.type && v.type !== state.type) return false;
    if (state.tags.size && ![...state.tags].every((tag) => (v.tags || []).includes(tag))) return false;
    return matches(v, tokens);
  });
  const cmp = {
    added: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    opened: (a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0),
    duration: (a, b) => (b.data?.duration || 0) - (a.data?.duration || 0),
  }[state.sort];
  return list.sort(cmp);
}
