/* ReelKeep universal persistence — zero deps, Node 18+.
   Reads data/library.json (v2); falls back to legacy data/videos.json (v1)
   and migrates it forward with a backup. The legacy file is never deleted.
   Writes are serialized and atomic (temp + rename); errors propagate. */
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('node:url');

async function createStore({ root, dataRoot = root, appVersion }) {
  const migrations = await import(pathToFileURL(path.join(root, 'js', 'migrations.mjs')).href);
  const schema = await import(pathToFileURL(path.join(root, 'js', 'schema.mjs')).href);

  const DATA_DIR = path.join(dataRoot, 'data');
  const LIB_FILE = path.join(DATA_DIR, 'library.json');
  const LEGACY_FILE = path.join(DATA_DIR, 'videos.json');
  const BACKUP_DIR = path.join(dataRoot, 'backups');
  for (const d of [DATA_DIR, BACKUP_DIR]) await fsp.mkdir(d, { recursive: true });

  let readOnly = false;

  async function backupOf(srcFile, label) {
    const base = `${label}-${Date.now()}`;
    let dest = path.join(BACKUP_DIR, `${base}.json`);
    for (let n = 1; fs.existsSync(dest); n++) dest = path.join(BACKUP_DIR, `${base}-${n}.json`);
    await fsp.copyFile(srcFile, dest, fs.constants.COPYFILE_EXCL);
    return dest;
  }

  async function atomicWrite(file, data) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  }

  async function quarantine(file) {
    const dest = `${file}.corrupt-${Date.now()}`;
    try {
      await fsp.rename(file, dest);
      console.error(`${path.basename(file)} unreadable, moved to ${dest}`);
    } catch (_) {
      /* file may not exist */
    }
  }

  async function readParsed(file) {
    try {
      return { ok: true, data: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } catch (err) {
      if (err.code === 'ENOENT') return { ok: false, missing: true };
      return { ok: false, corrupt: true };
    }
  }

  /** Load the universal library; migrate + backup when needed. */
  async function load() {
    let file = fs.existsSync(LIB_FILE) ? LIB_FILE : fs.existsSync(LEGACY_FILE) ? LEGACY_FILE : null;
    if (!file) {
      // First run: seed from the bundled example so the gallery isn't empty.
      // SEA builds materialize app assets under `root`, data lives in dataRoot.
      const example = [path.join(DATA_DIR, 'videos.example.json'), path.join(root, 'data', 'videos.example.json')].find((p) => fs.existsSync(p));
      if (example) await fsp.copyFile(example, LEGACY_FILE);
      else await atomicWrite(LEGACY_FILE, { version: 1, videos: [], folders: [] });
      file = LEGACY_FILE;
    }
    let parsed = await readParsed(file);
    if (parsed.corrupt) {
      // quarantine and start empty — never silently resurrect a stale legacy
      // file (backup restore with a prompt arrives with the backup feature)
      await quarantine(file);
      return schema.emptyLibrary();
    }
    const res = migrations.migrateLibrary(parsed.data, { now: new Date().toISOString() });
    if (res.invalid) return schema.emptyLibrary();
    if (res.readOnly) {
      readOnly = true;
      return res.data;
    }
    readOnly = false;
    if (res.changed) {
      await backupOf(file, path.basename(file, '.json'));
      await atomicWrite(LIB_FILE, res.data);
    }
    return res.data;
  }

  let writeQueue = Promise.resolve();
  /** Serialized atomic write; rejects on failure (never swallowed). */
  function write(lib) {
    const run = writeQueue.then(async () => {
      if (readOnly) throw Object.assign(new Error('library was written by a newer ReelKeep version — open read-only'), { status: 409 });
      await atomicWrite(LIB_FILE, lib);
    });
    writeQueue = run.catch(() => {});
    return run;
  }

  async function createBackup(reason = 'manual') {
    const src = fs.existsSync(LIB_FILE) ? LIB_FILE : LEGACY_FILE;
    if (!fs.existsSync(src)) return null;
    const safe = String(reason).replace(/[^\w-]+/g, '-').slice(0, 40) || 'manual';
    return path.basename(await backupOf(src, `library-${safe}`));
  }

  async function listBackups() {
    const names = await fsp.readdir(BACKUP_DIR).catch(() => []);
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const st = await fsp.stat(path.join(BACKUP_DIR, name)).catch(() => null);
      if (st) out.push({ name, size: st.size, modifiedAt: st.mtime.toISOString() });
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  return {
    LIB_FILE,
    LEGACY_FILE,
    DATA_DIR,
    BACKUP_DIR,
    schema,
    migrations,
    load,
    write,
    createBackup,
    listBackups,
    isReadOnly: () => readOnly,
  };
}

module.exports = { createStore };
