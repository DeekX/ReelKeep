/* ReelKeep handle-based storage — one factory for the File System Access API
   (folder mode) and OPFS (browser-only fallback). Same files on disk as server
   mode: library.json, thumbnails/, videos/, files/, backups/.
   Writes are careful-and-verified: backup → temp → verify → main → verify. */

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf',
};

const conflict = (rev) => Object.assign(new Error('another tab saved first'), { code: 'conflict', rev });

export function createHandleStorage(getRoot, { id }) {
  let root = null;
  const urls = new Map();

  async function dirHandle(rel, create = false) {
    let d = root;
    for (const seg of rel.split('/').filter(Boolean)) d = await d.getDirectoryHandle(seg, { create });
    return d;
  }
  async function fileHandle(rel, create = false) {
    const parts = rel.split('/');
    const name = parts.pop();
    const d = await dirHandle(parts.join('/'), create);
    return d.getFileHandle(name, { create });
  }
  async function readJson(name) {
    try {
      const fh = await root.getFileHandle(name);
      return JSON.parse(await (await fh.getFile()).text());
    } catch {
      return null;
    }
  }
  async function writeText(fh, text) {
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  return {
    id,
    capabilities: { files: true, atomicWrite: false, multiTabSafe: true },
    async open() {
      root = await getRoot();
    },
    async readLibrary() {
      return (await readJson('library.json')) ?? (await readJson('videos.json'));
    },
    async writeLibrary(data) {
      const current = await readJson('library.json');
      if (current && typeof current.rev === 'number' && typeof data.rev === 'number' && current.rev >= data.rev) {
        throw conflict(current.rev);
      }
      const text = JSON.stringify(data, null, 2);
      // rolling backup of the last good library (keep 3)
      if (current) {
        const backups = await dirHandle('backups', true);
        await writeText(await backups.getFileHandle(`library-${Date.now()}.json`, { create: true }), JSON.stringify(current, null, 2));
        const names = [];
        for await (const [name] of backups.entries()) if (/^library-\d+\.json$/.test(name)) names.push(name);
        names.sort();
        for (const old of names.slice(0, Math.max(0, names.length - 3))) await backups.removeEntry(old).catch(() => {});
      }
      // temp → verify → main → verify; a crash never leaves a truncated library
      const tmp = await root.getFileHandle('library.json.tmp', { create: true });
      await writeText(tmp, text);
      const staged = JSON.parse(await (await tmp.getFile()).text());
      if (JSON.stringify(staged) !== JSON.stringify(data)) throw new Error('library write verification failed');
      const main = await root.getFileHandle('library.json', { create: true });
      await writeText(main, text);
      const landed = JSON.parse(await (await main.getFile()).text());
      if (landed.rev !== data.rev) throw new Error('library write verification failed');
      await root.removeEntry('library.json.tmp').catch(() => {});
    },
    async putFile(relPath, payload) {
      let rel = relPath;
      if (rel.endsWith('/')) {
        const mime = payload.type || '';
        const ext = (payload.name && /\.[a-z0-9]+$/i.exec(payload.name)?.[0]) || EXT_BY_MIME[mime] || '.bin';
        rel = `${rel}${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
      }
      const fh = await fileHandle(rel, true);
      const w = await fh.createWritable();
      await w.write(payload);
      await w.close();
      return rel;
    },
    async getFile(relPath) {
      try {
        return await (await fileHandle(relPath)).getFile();
      } catch {
        return null;
      }
    },
    getFileUrl(relPath) {
      if (!relPath) return null;
      if (!urls.has(relPath)) {
        // resolved lazily by the caller through getFile; keep a sync placeholder
        // that the view layer upgrades (see library.fileUrl)
        return null;
      }
      return urls.get(relPath);
    },
    /** object URLs must be created async; views call this then render */
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
      const parts = relPath.split('/');
      const name = parts.pop();
      try {
        await (await dirHandle(parts.join('/'))).removeEntry(name);
      } catch {
        /* already gone */
      }
      if (urls.has(relPath)) {
        URL.revokeObjectURL(urls.get(relPath));
        urls.delete(relPath);
      }
    },
    async createBackup(reason) {
      const current = await readJson('library.json');
      if (!current) return;
      const backups = await dirHandle('backups', true);
      const safe = String(reason).replace(/[^\w-]+/g, '-').slice(0, 40);
      await writeText(await backups.getFileHandle(`library-${safe}-${Date.now()}.json`, { create: true }), JSON.stringify(current, null, 2));
    },
    async listBackups() {
      const out = [];
      try {
        const backups = await dirHandle('backups');
        for await (const [name, handle] of backups.entries()) {
          if (!name.endsWith('.json')) continue;
          const f = await handle.getFile();
          out.push({ name, size: f.size, modifiedAt: new Date(f.lastModified).toISOString() });
        }
      } catch {
        /* no backups dir yet */
      }
      return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    },
  };
}

/** Tier 1 folder mode: a real directory the user picked (Chrome/Edge desktop). */
export function createFolderStorage(handle) {
  return createHandleStorage(async () => handle, { id: 'folder' });
}

/** Tier 1 fallback: Origin Private File System (Firefox 111+, Safari 15.2+). */
export function createOpfsStorage() {
  return createHandleStorage(() => navigator.storage.getDirectory(), { id: 'opfs' });
}

export const hasOpfs = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;
export const hasFolderPicker = () => typeof window !== 'undefined' && !!window.showDirectoryPicker;

/** Persist / restore the picked directory handle across sessions (IndexedDB). */
const HANDLE_DB = 'reelkeep-handles';
function openHandleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function saveFolderHandle(handle) {
  const db = await openHandleDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'folder');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
export async function loadFolderHandle() {
  try {
    const db = await openHandleDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('folder');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return handle;
  } catch {
    return null;
  }
}
export async function forgetFolderHandle() {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').delete('folder');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* nothing stored */
  }
}
