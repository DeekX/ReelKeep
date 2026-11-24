/* ReelKeep storage adapters — one small contract, many backends.
   The library core is the only caller; UI never touches fetch/localStorage.
   Phase 1: server (HTTP API) + local (localStorage). Folder/OPFS/IndexedDB
   adapters arrive with browser-only mode (Phase 3). */

import { dataUrlToBlob } from './util.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function jsonOrThrow(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

/** Tier 3: the companion Node server. Atomic writes, real files on disk. */
export function createServerStorage() {
  return {
    id: 'server',
    capabilities: { files: true, atomicWrite: true, multiTabSafe: false },
    async open() {},
    async readLibrary() {
      const res = await fetch('/api/library', { headers: { Accept: 'application/json' } });
      const { library } = await jsonOrThrow(res);
      return library;
    },
    async writeLibrary(data) {
      await jsonOrThrow(await fetch('/api/library', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(data) }));
    },
    /** Stores a cover (dataURL) or an upload (File/Blob); returns the stored relative path. */
    async putFile(relPath, payload, onProgress) {
      if (relPath.startsWith('thumbnails/')) {
        const dataUrl = typeof payload === 'string' ? payload : await blobToDataUrl(payload);
        const { thumbnail } = await jsonOrThrow(
          await fetch('/api/thumbnails', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ dataUrl }) }),
        );
        return thumbnail;
      }
      if (relPath.startsWith('videos/')) {
        return uploadXhr(payload, onProgress);
      }
      if (relPath.startsWith('files/')) {
        const res = await fetch('/api/files?dir=files', {
          method: 'POST',
          headers: { 'X-File-Name': encodeURIComponent(payload.name || 'file.bin') },
          body: payload,
        });
        const { path } = await jsonOrThrow(res);
        return path;
      }
      throw new Error(`unsupported file target: ${relPath}`);
    },
    async snapshotUrl(url) {
      return jsonOrThrow(await fetch('/api/snapshot', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url }) }));
    },
    async getFile(relPath) {
      const res = await fetch('/' + relPath.replace(/^\/+/, ''));
      return res.ok ? res.blob() : null;
    },
    getFileUrl(relPath) {
      return relPath ? '/' + relPath.replace(/^\/+/, '') : null;
    },
    async deleteFile(relPath) {
      await jsonOrThrow(await fetch(`/api/files?path=${encodeURIComponent(relPath)}`, { method: 'DELETE' }));
    },
    /** Copy a hotlinked image into thumbnails/ so it never breaks; falls back to the URL. */
    async copyImageFromUrl(url, referer) {
      const { thumbnail } = await jsonOrThrow(
        await fetch('/api/thumbnails/from-url', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ url, referer }) }),
      );
      return thumbnail;
    },
    async createBackup(reason) {
      await jsonOrThrow(await fetch('/api/backups', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ reason }) }));
    },
    async listBackups() {
      const { backups } = await jsonOrThrow(await fetch('/api/backups'));
      return backups;
    },
    /** Companion enricher: page metadata from the server's reader. */
    async enrichUrl(url) {
      return jsonOrThrow(await fetch(`/api/enrich?url=${encodeURIComponent(url)}`));
    },
  };
}

function uploadXhr(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/videos/upload');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'upload.mp4'));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status < 300) resolve(body.fileUrl.replace(/^\/+/, ''));
        else reject(new Error(body.error || xhr.statusText));
      } catch {
        reject(new Error('upload failed'));
      }
    };
    xhr.onerror = () => reject(new Error('upload lost'));
    xhr.send(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

const LS_KEY = 'video-gallery.v1';
const FILES_KEY = 'video-gallery.files';
const BACKUP_KEY = 'video-gallery.backup';

/** Tier 1 fallback: browser storage. Covers live as data URLs; uploads need the server. */
export function createLocalStorage() {
  const readFiles = () => {
    try {
      return JSON.parse(localStorage.getItem(FILES_KEY)) || {};
    } catch {
      return {};
    }
  };
  const writeFiles = (files) => localStorage.setItem(FILES_KEY, JSON.stringify(files));
  return {
    id: 'local',
    capabilities: { files: false, atomicWrite: false, multiTabSafe: false },
    async open() {},
    async readLibrary() {
      try {
        return JSON.parse(localStorage.getItem(LS_KEY));
      } catch {
        return null;
      }
    },
    async writeLibrary(data) {
      localStorage.setItem(LS_KEY, JSON.stringify(data)); // quota errors propagate to the core
    },
    async putFile(relPath, payload) {
      const isThumb = relPath.startsWith('thumbnails/');
      if (!isThumb && !relPath.startsWith('files/')) throw new Error(t('err.uploadlocal'));
      const dataUrl = typeof payload === 'string' ? payload : await blobToDataUrl(payload);
      // browser storage is small: keep uploads honest about the quota
      if (!isThumb && dataUrl.length > 4 * 1024 * 1024 * 1.37) throw new Error(t('err.toolargelocal'));
      const files = readFiles();
      const dir = isThumb ? 'thumbnails' : 'files';
      const key = `${dir}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}${isThumb ? '.jpg' : '.bin'}`;
      files[key] = dataUrl;
      writeFiles(files);
      return key;
    },
    async getFile(relPath) {
      const dataUrl = readFiles()[relPath];
      return dataUrl ? dataUrlToBlob(dataUrl) : null;
    },
    getFileUrl(relPath) {
      return readFiles()[relPath] || null;
    },
    async deleteFile(relPath) {
      const files = readFiles();
      delete files[relPath];
      writeFiles(files);
    },
    async copyImageFromUrl(url) {
      return url; // no server to copy through — hotlink stays, honestly
    },
    /** all stored files as data URLs (export bundle); server files live on disk */
    async allFiles() {
      return readFiles();
    },
    async importFiles(map) {
      const files = readFiles();
      for (const [k, v] of Object.entries(map || {})) {
        if (/^(thumbnails|files)\//.test(k) && typeof v === 'string' && v.startsWith('data:')) files[k] = v;
      }
      writeFiles(files);
    },
    async createBackup(reason) {
      const current = localStorage.getItem(LS_KEY);
      if (current != null) localStorage.setItem(`${BACKUP_KEY}.${reason}`, current);
    },
    async listBackups() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(BACKUP_KEY + '.')) out.push({ name: k, size: localStorage.getItem(k).length, modifiedAt: '' });
      }
      return out;
    },
  };
}
