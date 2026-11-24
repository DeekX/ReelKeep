/* Storage conformance — the same contract runs against every adapter that can
   run in Node (server over HTTP, local over a localStorage stub). Handle-based
   adapters (folder/OPFS/IDB) run the same contract in the browser smoke. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-conf-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'app.js', 'styles.css', 'i18n.js']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  for (const d of ['lib', 'js']) await fsp.cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 15000);
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.stderr.on('data', (c) => process.stderr.write(c));
    child.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (child) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** The contract every adapter must satisfy. */
async function conformance(storage, { files }) {
  await storage.open();
  const lib = {
    schemaVersion: 2,
    meta: { createdAt: '2026-11-24T00:00:00.000Z', app: 'reelkeep', appVersion: '2.1.0' },
    rev: 1,
    folders: [{ id: 'f_c1', name: 'Conf', createdAt: '2026-11-24T00:00:00.000Z', order: 0 }],
    items: [{ id: 'i_c1', type: 'note', title: 'N', url: '', source: { name: '', domain: '' }, folderId: null, tags: [], notes: '', cover: { kind: 'none', path: '', origin: 'auto' }, createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z', lastOpenedAt: null, openCount: 0, pinned: false, data: { body: 'x', format: 'markdown' } }],
  };
  await storage.writeLibrary(lib);
  const back = await storage.readLibrary();
  assert.deepEqual(back.items, lib.items);
  assert.deepEqual(back.folders, lib.folders);
  assert.equal(back.rev, 1);

  // stale write is a conflict, never a silent overwrite
  await assert.rejects(() => storage.writeLibrary({ ...lib, rev: 1 }), (e) => e.code === 'conflict');
  await storage.writeLibrary({ ...lib, rev: 2, items: [...lib.items, { ...lib.items[0], id: 'i_c2', title: 'N2' }] });
  assert.equal((await storage.readLibrary()).items.length, 2);

  if (files) {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])], { type: 'image/png' });
    const rel = await storage.putFile('thumbnails/', blob);
    assert.match(rel, /^thumbnails\/.+/);
    const got = await storage.getFile(rel);
    assert.ok(got);
    assert.equal(got.size, blob.size);
    const url = storage.getFileUrl(rel) || (await storage.fileUrl?.(rel));
    assert.ok(url, 'a renderable URL must exist');
    await storage.deleteFile(rel);
    assert.equal(await storage.getFile(rel), null);
  }

  await storage.createBackup('conformance');
  const backups = await storage.listBackups();
  assert.ok(backups.length >= 1);
}

test('server adapter satisfies the storage contract', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => realFetch(new URL(input, base).href, init);
  try {
    const { createServerStorage } = await load('js/storage.mjs');
    await conformance(createServerStorage(), { files: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('local (localStorage) adapter satisfies the storage contract', async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  globalThis.t = (k) => k;
  try {
    const { createLocalStorage } = await load('js/storage.mjs');
    await conformance(createLocalStorage(), { files: true });
  } finally {
    delete globalThis.localStorage;
    delete globalThis.t;
  }
});
