/* ReelKeep IndexedDB storage — last-resort browser-only fallback (no OPFS).
   Library JSON in one store, file blobs in another; same conflict rules. */

const DB = 'reelkeep-library';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lib')) db.createObjectStore('lib');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createIdbStorage() {
  let db = null;
  const urls = new Map();
  return {
    id: 'idb',
    capabilities: { files: true, atomicWrite: false, multiTabSafe: true },
    async open() {
      db = await openDb();
    },
    async readLibrary() {
      return (await tx(db, 'lib', 'readonly', (s) => s.get('library'))) || null;
    },
    async writeLibrary(data) {
      const current = await this.readLibrary();
      if (current && typeof current.rev === 'number' && typeof data.rev === 'number' && current.rev >= data.rev) {
        throw Object.assign(new Error('another tab saved first'), { code: 'conflict', rev: current.rev });
      }
      await tx(db, 'lib', 'readwrite', (s) => s.put(data, 'library'));
    },
    async putFile(relPath, payload) {
      let rel = relPath;
      if (rel.endsWith('/')) {
        const ext = (payload.name && /\.[a-z0-9]+$/i.exec(payload.name)?.[0]) || '.bin';
        rel = `${rel}${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
      }
      const blob = typeof payload === 'string' ? await (await fetch(payload)).blob() : payload;
      await tx(db, 'files', 'readwrite', (s) => s.put(blob, rel));
      return rel;
    },
    async getFile(relPath) {
      return (await tx(db, 'files', 'readonly', (s) => s.get(relPath))) || null;
    },
    getFileUrl(relPath) {
      return urls.get(relPath) || null;
    },
    async fileUrl(relPath) {
      if (!relPath) return null;
      if (!urls.has(relPath)) {
        const blob = await this.getFile(relPath);
        if (!blob) return null;
        urls.set(relPath, URL.createObjectURL(blob));
      }
      return urls.get(relPath);
    },
    async deleteFile(relPath) {
      await tx(db, 'files', 'readwrite', (s) => s.delete(relPath));
      if (urls.has(relPath)) {
        URL.revokeObjectURL(urls.get(relPath));
        urls.delete(relPath);
      }
    },
    async createBackup(reason) {
      const current = await this.readLibrary();
      if (current) await tx(db, 'lib', 'readwrite', (s) => s.put(current, `backup:${reason}:${Date.now()}`));
    },
    async listBackups() {
      const keys = await tx(db, 'lib', 'readonly', (s) => s.getAllKeys());
      return keys.filter((k) => String(k).startsWith('backup:')).map((k) => ({ name: String(k), size: 0, modifiedAt: '' }));
    },
  };
}

export const hasIdb = () => typeof indexedDB !== 'undefined';
