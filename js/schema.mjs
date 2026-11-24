/* ReelKeep universal library schema (v2) — shared by browser and server.
   Plain JSON, human-readable, forward-compatible: unknown fields survive. */

import { hostOf } from './util.mjs';

export const SCHEMA_VERSION = 2;
export const APP_VERSION = '2.6.1';
export const ITEM_TYPES = ['video', 'audio', 'image', 'article', 'link', 'pdf', 'note', 'file'];

export function newId(prefix = 'i') {
  const c = globalThis.crypto;
  const rand = c?.randomUUID
    ? c.randomUUID().replace(/-/g, '').slice(0, 12)
    : Array.from({ length: 12 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  return `${prefix}_${rand}`;
}

export const nowIso = () => new Date().toISOString();

export function emptyLibrary(now = nowIso()) {
  return { schemaVersion: SCHEMA_VERSION, meta: { createdAt: now, app: 'reelkeep', appVersion: APP_VERSION }, folders: [], items: [] };
}

/** Relative library paths only: forward slashes, no traversal, no absolute/drive paths. */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 512) return false;
  if (p.includes('\0') || p.includes('\\')) return false;
  if (p.startsWith('/') || /^[a-z]:/i.test(p)) return false;
  return p.split('/').every((seg) => seg && seg !== '.' && seg !== '..');
}

const ORIGIN_FROM_SOURCE = { frame: 'frame', upload: 'upload', url: 'url' };
const SOURCE_FROM_ORIGIN = { frame: 'frame', upload: 'upload', url: 'url' };

export function coverFromLegacy(thumbnail, thumbSource) {
  const origin = ORIGIN_FROM_SOURCE[thumbSource] || 'auto';
  if (!thumbnail) return { kind: 'none', path: '', origin: 'auto' };
  if (/^(thumbnails|files)\//.test(thumbnail)) return { kind: 'file', path: thumbnail, origin };
  return { kind: 'url', path: thumbnail, origin };
}

const ENVELOPE_KEYS = new Set([
  'id', 'type', 'title', 'url', 'source', 'folderId', 'tags', 'notes', 'cover',
  'createdAt', 'updatedAt', 'lastOpenedAt', 'openCount', 'pinned', 'data',
]);
const LEGACY_KEYS = new Set([
  'id', 'title', 'url', 'kind', 'provider', 'videoId', 'embedUrl', 'fileUrl', 'folderId',
  'tags', 'notes', 'startAt', 'thumbnail', 'thumbSource', 'thumbTime', 'favicon', 'site',
  'duration', 'addedAt', 'lastOpenedAt',
]);

/** v1 video record → v2 universal item (type video). Unknown keys are preserved. */
export function legacyToItem(v, { id, now = nowIso() } = {}) {
  // v1 bug: Twitch parse leaked kind 'vods'/'clip' into the record kind, which
  // bypassed the provider embed branch. Normalize on the way in.
  let kind = v.kind || 'page';
  if (v.provider === 'twitch' && (kind === 'vods' || kind === 'clip')) kind = 'embed';
  const item = {
    id: v.id || id || newId('i'),
    type: 'video',
    title: v.title || '',
    url: v.url || '',
    source: { name: v.site || '', domain: hostOf(v.url) },
    folderId: v.folderId || null,
    tags: Array.isArray(v.tags) ? v.tags : [],
    notes: v.notes || '',
    cover: coverFromLegacy(v.thumbnail, v.thumbSource),
    createdAt: v.addedAt || now,
    updatedAt: v.addedAt || now,
    lastOpenedAt: v.lastOpenedAt ?? null,
    openCount: 0,
    pinned: false,
    data: {
      kind,
      provider: v.provider || 'page',
      videoId: v.videoId ?? null,
      playerUrl: v.embedUrl || '',
      fileUrl: v.fileUrl || '',
      startAt: v.startAt || 0,
      progress: null,
      duration: v.duration ?? null,
      favicon: v.favicon || '',
      thumbSource: v.thumbSource || 'auto',
      thumbTime: v.thumbTime ?? null,
    },
  };
  for (const [k, val] of Object.entries(v)) if (!LEGACY_KEYS.has(k)) item[k] = val;
  return item;
}

/** v2 video item → v1 record shape (legacy API compatibility). */
export function itemToLegacy(item) {
  const d = item.data || {};
  const v = {
    id: item.id,
    title: item.title || '',
    url: item.url || '',
    kind: d.kind || 'page',
    provider: d.provider || 'page',
    videoId: d.videoId ?? null,
    embedUrl: d.playerUrl || '',
    fileUrl: d.fileUrl || '',
    folderId: item.folderId || '',
    tags: item.tags || [],
    notes: item.notes || '',
    startAt: d.startAt || 0,
    thumbnail: item.cover?.kind === 'none' || !item.cover ? '' : item.cover.path || '',
    thumbSource: d.thumbSource || SOURCE_FROM_ORIGIN[item.cover?.origin] || 'auto',
    thumbTime: d.thumbTime ?? null,
    favicon: d.favicon || '',
    site: item.source?.name || '',
    duration: d.duration ?? null,
    addedAt: item.createdAt,
    lastOpenedAt: item.lastOpenedAt ?? null,
  };
  for (const [k, val] of Object.entries(item)) if (!ENVELOPE_KEYS.has(k)) v[k] = val;
  return v;
}

/** Shallow v1-style PATCH applied to a v2 item; id pinned, unknown keys preserved. */
export function applyLegacyPatch(item, body) {
  const d = item.data || (item.data = {});
  for (const [k, val] of Object.entries(body)) {
    switch (k) {
      case 'id': break;
      case 'title': case 'url': case 'tags': case 'notes': item[k] = val; break;
      case 'folderId': item.folderId = val || null; break;
      case 'addedAt': item.createdAt = val; break;
      case 'lastOpenedAt': item.lastOpenedAt = val ?? null; break;
      case 'site': item.source = { ...(item.source || {}), name: val || '' }; break;
      case 'thumbnail':
        item.cover = coverFromLegacy(val, body.thumbSource ?? d.thumbSource);
        break;
      case 'thumbSource': d.thumbSource = val || 'auto'; break;
      case 'thumbTime': d.thumbTime = val ?? null; break;
      case 'embedUrl': d.playerUrl = val || ''; break;
      case 'kind': case 'provider': case 'videoId': case 'fileUrl': case 'startAt': case 'duration': case 'favicon': case 'progress':
        d[k] = val; break;
      case 'data': Object.assign(d, val || {}); break;
      default: item[k] = val; // unknown fields survive (forward compatibility)
    }
  }
  item.updatedAt = nowIso();
  return item;
}

export const legacyFolderView = (f) => ({ id: f.id, name: f.name, createdAt: f.createdAt });

/** Light shape validation for whole-library writes and imports. */
export function validateLibrary(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'library must be an object' };
  if (!Array.isArray(data.items)) return { ok: false, error: 'library.items must be an array' };
  if (!Array.isArray(data.folders)) return { ok: false, error: 'library.folders must be an array' };
  for (const f of data.folders) {
    if (!f || typeof f.id !== 'string' || typeof f.name !== 'string') return { ok: false, error: 'folder needs id and name' };
  }
  const ids = new Set();
  for (const it of data.items) {
    if (!it || typeof it.id !== 'string' || !it.id) return { ok: false, error: 'item needs an id' };
    if (ids.has(it.id)) return { ok: false, error: `duplicate item id ${it.id}` };
    ids.add(it.id);
    if (typeof it.type !== 'string') return { ok: false, error: `item ${it.id} needs a type` };
    if (it.cover?.kind === 'file' && !isSafeRelPath(it.cover.path)) return { ok: false, error: `item ${it.id} has an unsafe cover path` };
  }
  return { ok: true };
}
