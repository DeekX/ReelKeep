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
  mode: 'server', // server | folder | opfs | idb | local
  current: null, // item open in the lightbox
  lastTime: 0,
  readOnly: false,
  rev: 0, // library revision, for multi-tab safety
  deleted: new Set(), // ids removed since the last load (merge tombstones)
  smart: '', // '' | recent | opened | untagged | dups | trash | broken
};

/* Precomputed lowercase search text per item (indexed search at 10k scale). */
let searchIndex = new Map();
export function indexItem(item) {
  const extra = getHandler(item.type)?.searchText?.(item) || '';
  searchIndex.set(
    item.id,
    [item.title, item.notes, item.url, labelOf(item), extra, ...(item.tags || [])].join(' ').toLowerCase(),
  );
}
export function rebuildIndex() {
  searchIndex = new Map();
  state.items.forEach(indexItem);
}

/** Canonical URL for duplicate detection: scheme/host lowercased, no www/hash/
    trailing slash, sorted query. */
export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const params = [...u.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const q = params.length ? '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    return `${u.protocol}//${host}${path}${q}`;
  } catch {
    return '';
  }
}

export function duplicateIds() {
  const seen = new Map();
  for (const it of state.items) {
    if (it.trashedAt) continue;
    const key = normalizeUrl(it.url);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  const out = new Set();
  for (const it of state.items) {
    if (it.trashedAt) continue;
    const key = normalizeUrl(it.url);
    if (key && seen.get(key) > 1) out.add(it.id);
  }
  return out;
}

let storage = null;
let meta = null;
let onChange = () => {};
let channel = null;
const tabId = Math.random().toString(36).slice(2);

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
  state.readOnly = !!res.readOnly; // newer-schema library; offline is tracked on the adapter
  state.rev = res.data?.rev || 0;
  state.deleted.clear();
  rebuildIndex();
  if (res.changed && storage.id !== 'server') {
    // the server backs up its own migrations; browser storage backs up here
    await storage.createBackup('pre-migration').catch(() => {});
    await storage.writeLibrary({ ...res.data, rev: state.rev + 1 });
    state.rev += 1;
  }
  if (typeof BroadcastChannel !== 'undefined' && !channel) {
    channel = new BroadcastChannel('reelkeep-sync');
    channel.onmessage = async (e) => {
      const msg = e.data;
      if (!msg || msg.tab === tabId || !(msg.rev > state.rev)) return;
      const remote = await storage.readLibrary();
      if (!remote || !(remote.rev > state.rev)) return;
      mergeRemote(remote);
      const contributed = JSON.stringify([state.items, state.folders]) !== JSON.stringify([remote.items, remote.folders]);
      onChange();
      if (contributed) save(); // persist our merged edits; otherwise stay quiet
    };
  }
}

/** Merge a newer remote library into memory: newer updatedAt wins per item,
    local additions survive, local deletions stay deleted. Never overwrites blind. */
export function mergeRemote(remote) {
  const rItems = new Map((remote.items || []).map((i) => [i.id, i]));
  const localOnly = state.items.filter((i) => !rItems.has(i.id) && !state.deleted.has(i.id));
  const merged = (remote.items || [])
    .filter((r) => !state.deleted.has(r.id))
    .map((r) => {
      const local = state.items.find((i) => i.id === r.id);
      if (!local) return r;
      return Date.parse(local.updatedAt || 0) > Date.parse(r.updatedAt || 0) ? local : r;
    });
  const rFolders = new Map((remote.folders || []).map((f) => [f.id, f]));
  for (const f of state.folders) if (!rFolders.has(f.id)) rFolders.set(f.id, f);
  state.items = [...localOnly, ...merged];
  state.folders = [...rFolders.values()];
  state.rev = remote.rev || 0;
  state.deleted.clear();
  rebuildIndex();
}

/** Object URLs for handle-based adapters must be created async; warm them so
    the sync getFileUrl() used by views can resolve covers and files. */
export async function warmFileUrls() {
  const st = getStorage();
  if (!st?.fileUrl) return;
  const paths = new Set();
  for (const it of state.items) {
    if (it.cover?.kind === 'file' && it.cover.path) paths.add(it.cover.path);
    if (it.data?.filePath) paths.add(it.data.filePath);
  }
  await Promise.all([...paths].map((p) => st.fileUrl(p).catch(() => null)));
}

export function snapshot() {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: meta || { createdAt: nowIso(), app: 'reelkeep', appVersion: APP_VERSION },
    rev: state.rev + 1,
    folders: state.folders,
    items: state.items,
  };
}

function broadcast() {
  channel?.postMessage({ tab: tabId, rev: state.rev });
}

const persist = debounce(async () => {
  if (!storage || state.readOnly || storage.readOnly || storage.offline) return;
  try {
    await storage.writeLibrary(snapshot());
    state.rev += 1;
    broadcast();
    await warmFileUrls();
  } catch (err) {
    if (err.code === 'conflict') {
      // another tab or window saved first: merge, never overwrite blind
      try {
        const remote = await storage.readLibrary();
        if (remote) {
          mergeRemote(remote);
          await storage.writeLibrary(snapshot());
          state.rev += 1;
          broadcast();
          onChange();
          return;
        }
      } catch {
        /* fall through to the visible error below */
      }
    }
    toast(t('to.savefail', { err: err.message }), 'err', 6000);
    // roll back to what is actually stored rather than silently diverging
    try {
      const raw = await storage.readLibrary();
      const res = migrateLibrary(raw ?? emptyLibrary(), { now: nowIso() });
      state.items = res.data.items || [];
      state.folders = res.data.folders || [];
      state.rev = res.data?.rev || 0;
      rebuildIndex();
      onChange();
    } catch {
      /* storage unreachable — the error toast already told the user */
    }
  }
}, 300);

export function save() {
  if (storage?.offline) {
    toast(t('to.offline'), 'err', 5000);
    return;
  }
  if (state.readOnly || storage?.readOnly) {
    toast(t('to.readonly'), 'err', 5000);
    return;
  }
  persist();
}

export async function flushSave() {
  persist.cancel();
  if (storage && !state.readOnly && !storage.readOnly && !storage.offline) await storage.writeLibrary(snapshot());
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
  indexItem(item);
  save();
  if (rerender) onChange();
  return item;
}

export async function addItem(input) {
  const handler = getHandler(input.type || 'video') || getHandler('link');
  const item = await handler.create(input, {});
  state.items.unshift(item);
  indexItem(item);
  await warmFileUrls();
  save();
  onChange();
  return item;
}

/** Delete = move to recoverable trash; permanent removal is purgeItem. */
export async function removeItem(id) {
  const item = byId(id);
  if (!item) return;
  item.trashedAt = nowIso();
  item.updatedAt = nowIso();
  state.selected.delete(id);
  save();
  onChange();
}

export async function purgeItem(id) {
  const item = byId(id);
  if (!item) return;
  if (item.cover?.kind === 'file' && /^thumbnails\//.test(item.cover.path || '') && storage) {
    await storage.deleteFile(item.cover.path).catch(() => {});
  }
  state.items = state.items.filter((v) => v.id !== id);
  state.selected.delete(id);
  state.deleted.add(id);
  searchIndex.delete(id);
  save();
  onChange();
}

export function restoreItem(id) {
  const item = byId(id);
  if (!item) return;
  item.trashedAt = null;
  item.updatedAt = nowIso();
  save();
  onChange();
}

export async function purgeExpiredTrash(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  const expired = state.items.filter((v) => v.trashedAt && Date.parse(v.trashedAt) < cutoff);
  for (const v of expired) await purgeItem(v.id);
  return expired.length;
}

/** Import batch: one save, one undo unit. */
export async function addBatch(inputs) {
  const created = [];
  for (const input of inputs) {
    const handler = getHandler(input.type || 'link') || getHandler('link');
    const item = await handler.create(input, {});
    created.push(item);
    indexItem(item);
  }
  state.items = [...created, ...state.items];
  await warmFileUrls();
  save();
  onChange();
  return created;
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
  gone.forEach((v) => {
    state.selected.delete(v.id);
    state.deleted.add(v.id);
  });
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
  const hay = searchIndex.get(item.id) ?? '';
  return tokens.every((tok) => hay.includes(tok));
}

export function visibleItems() {
  const tokens = state.tokens;
  const dups = state.smart === 'dups' ? duplicateIds() : null;
  const week = Date.now() - 7 * 86400000;
  const list = state.items.filter((v) => {
    const trashed = !!v.trashedAt;
    if (state.smart === 'trash') return trashed;
    if (trashed) return false;
    if (state.smart === 'recent' && Date.parse(v.createdAt || 0) < week) return false;
    if (state.smart === 'opened' && !v.lastOpenedAt) return false;
    if (state.smart === 'untagged' && (v.tags || []).length) return false;
    if (state.smart === 'dups' && !dups.has(v.id)) return false;
    if (state.smart === 'broken' && v.data?.linkStatus !== 'dead') return false;
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
  }[state.smart === 'opened' ? 'opened' : state.sort];
  return list.sort(cmp);
}
