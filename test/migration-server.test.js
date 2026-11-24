/* Integration: legacy videos.json migrates to library.json on startup —
   with a backup, the legacy file preserved, and restart idempotency. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden-v1.json');

let dir;
let child;
let base;

async function startServer() {
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
}

async function stopServer() {
  if (!child) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
  child = null;
}

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-mig-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'app.js', 'styles.css', 'i18n.js']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  for (const d of ['lib', 'js']) {
    await fsp.cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  }
  await fsp.copyFile(GOLDEN, path.join(dir, 'data', 'videos.json'));
  await startServer();
});

after(async () => {
  await stopServer();
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('startup migrates videos.json → library.json with a backup', async () => {
  const libFile = path.join(dir, 'data', 'library.json');
  assert.ok(fs.existsSync(libFile), 'library.json must exist after startup');
  const lib = JSON.parse(await fsp.readFile(libFile, 'utf8'));
  assert.equal(lib.schemaVersion, 2);
  assert.equal(lib.items.length, 7);
  assert.equal(lib.folders.length, 2);
  assert.ok(lib.items.every((i) => i.type === 'video'));

  // legacy file preserved byte-for-byte
  const legacy = await fsp.readFile(path.join(dir, 'data', 'videos.json'), 'utf8');
  assert.equal(legacy, await fsp.readFile(GOLDEN, 'utf8'));

  // exactly one backup, equal to the legacy content
  const backups = (await fsp.readdir(path.join(dir, 'backups'))).filter((f) => /^videos-\d+\.json$/.test(f));
  assert.equal(backups.length, 1);
  assert.equal(await fsp.readFile(path.join(dir, 'backups', backups[0]), 'utf8'), legacy);
});

test('GET /api/library serves v2; legacy /api/state still works', async () => {
  const res = await fetch(`${base}/api/library`);
  assert.equal(res.status, 200);
  const { library, readOnly } = await res.json();
  assert.equal(library.schemaVersion, 2);
  assert.equal(readOnly, false);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.version, 1);
  assert.equal(state.videos.length, 7);
});

test('a future-version library is refused, not downgraded', async () => {
  const future = { schemaVersion: 99, meta: {}, folders: [], items: [] };
  const res = await fetch(`${base}/api/library`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(future),
  });
  assert.equal(res.status, 409);
  const lib = JSON.parse(await fsp.readFile(path.join(dir, 'data', 'library.json'), 'utf8'));
  assert.equal(lib.schemaVersion, 2);
});

test('PUT /api/library round-trips and restart adds no new backup', async () => {
  const { library } = await (await fetch(`${base}/api/library`)).json();
  library.items[0].title = 'Renamed via PUT';
  const put = await fetch(`${base}/api/library`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(library),
  });
  assert.equal(put.status, 200);
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.ok(state.videos.some((v) => v.title === 'Renamed via PUT'));

  await stopServer();
  await startServer();
  const backups = (await fsp.readdir(path.join(dir, 'backups'))).filter((f) => f.endsWith('.json'));
  assert.equal(backups.length, 1, 'restart must not re-migrate or re-backup');
  const after = await (await fetch(`${base}/api/state`)).json();
  assert.ok(after.videos.some((v) => v.title === 'Renamed via PUT'));
});
