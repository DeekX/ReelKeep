/* Characterization tests — pin the exact v1 semantics the universal-library
   refactor must preserve (roadmap Phase 0). node:test only, no dependencies. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GOLDEN = path.join(__dirname, 'fixtures', 'golden-v1.json');

let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-char-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'app.js', 'styles.css', 'i18n.js']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  // start from the golden fixture instead of the example seed
  await fsp.copyFile(GOLDEN, path.join(dir, 'data', 'videos.json'));

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

const get = (p) => fetch(base + p);
const json = (p, method, body) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('state returns the v1 envelope with every golden record intact', async () => {
  const res = await get('/api/state');
  assert.equal(res.status, 200);
  const db = await res.json();
  assert.equal(db.version, 1);
  const golden = JSON.parse(await fsp.readFile(GOLDEN, 'utf8'));
  assert.equal(db.videos.length, golden.videos.length);
  assert.deepEqual(db.folders, golden.folders);
  for (const v of golden.videos) {
    const got = db.videos.find((x) => x.id === v.id);
    assert.ok(got, `missing ${v.id}`);
    for (const [k, val] of Object.entries(v)) assert.deepEqual(got[k], val, `${v.id}.${k}`);
  }
});

test('POST assigns id/addedAt/lastOpenedAt and keeps unknown fields', async () => {
  const { video } = await (
    await json('/api/videos', 'POST', { title: 'X', url: 'https://e.com/v', kind: 'embed', provider: 'youtube', custom: { a: 1 } })
  ).json();
  assert.match(video.id, /^v_[\w-]{12}$/);
  assert.ok(!Number.isNaN(Date.parse(video.addedAt)));
  assert.equal(video.lastOpenedAt, null);
  assert.deepEqual(video.custom, { a: 1 });
});

test('PATCH merges shallowly, pins id, preserves unknown fields', async () => {
  const { video } = await (await json('/api/videos', 'POST', { title: 'Before', url: 'https://e.com/p', extra: [1, 2] })).json();
  const patched = await (await json(`/api/videos/${video.id}`, 'PATCH', { title: 'After', id: 'v_hacked', tags: ['t'] })).json();
  assert.equal(patched.video.id, video.id);
  assert.equal(patched.video.title, 'After');
  assert.deepEqual(patched.video.tags, ['t']);
  assert.deepEqual(patched.video.extra, [1, 2]);
  assert.equal(patched.video.url, 'https://e.com/p');
});

test('move to empty string unfiles; unknown folder is 404', async () => {
  const state = await (await get('/api/state')).json();
  const id = state.videos.find((v) => v.folderId)?.id;
  const moved = await json('/api/videos/move', 'POST', { ids: [id], folderId: '' });
  assert.equal((await moved.json()).moved, 1);
  const after = await (await get('/api/state')).json();
  assert.equal(after.videos.find((v) => v.id === id).folderId, '');
  assert.equal((await json('/api/videos/move', 'POST', { ids: [id], folderId: 'f_missing' })).status, 404);
});

test('folder delete cascades to member videos and their stored covers only', async () => {
  const { folder } = await (await json('/api/folders', 'POST', { name: 'Doomed' })).json();
  const { video } = await (await json('/api/videos', 'POST', { title: 'Member', url: 'https://e.com/m', folderId: folder.id })).json();
  const res = await fetch(`${base}/api/folders/${folder.id}`, { method: 'DELETE' });
  assert.equal((await res.json()).deleted, 1);
  const state = await (await get('/api/state')).json();
  assert.ok(!state.videos.some((v) => v.id === video.id));
  assert.ok(!state.folders.some((f) => f.id === folder.id));
});

test('upload names are generated, never the user-supplied name', async () => {
  const res = await fetch(`${base}/api/videos/upload`, {
    method: 'POST',
    headers: { 'X-File-Name': encodeURIComponent('../../evil name.mp4') },
    body: Buffer.from('bytes'),
  });
  const up = await res.json();
  assert.match(up.fileName, /^\d+_[\w-]{8}\.mp4$/);
  assert.ok(!up.fileName.includes('evil'));
  assert.ok(fs.existsSync(path.join(dir, 'videos', up.fileName)));
});

test('thumbnail dataUrl must be an allowed image type', async () => {
  assert.equal((await json('/api/thumbnails', 'POST', { dataUrl: 'data:text/html;base64,PGI+' })).status, 400);
  assert.equal((await json('/api/thumbnails', 'POST', { dataUrl: 'not a data url' })).status, 400);
});

test('enrich and media reject non-http(s) schemes with 400', async () => {
  for (const u of ['ftp://x.com', 'file:///c:/windows', 'javascript:alert(1)', 'data:text/html,x', '']) {
    assert.equal((await get(`/api/enrich?url=${encodeURIComponent(u)}`)).status, 400, u);
    assert.equal((await get(`/media?url=${encodeURIComponent(u)}`)).status, 400, u);
  }
});

test('API answers OPTIONS with permissive CORS (v1 behavior, pinned)', async () => {
  const res = await fetch(`${base}/api/state`, { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('static range requests: suffix range and unsatisfiable range', async () => {
  const res = await fetch(`${base}/api/videos/upload`, { method: 'POST', headers: { 'X-File-Name': 'r.mp4' }, body: Buffer.from('0123456789') });
  const { fileUrl } = await res.json();
  const suffix = await fetch(base + fileUrl, { headers: { Range: 'bytes=-3' } });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), '789');
  const bad = await fetch(base + fileUrl, { headers: { Range: 'bytes=99-' } });
  assert.equal(bad.status, 416);
});

test('corrupt library is quarantined with .corrupt- suffix and state stays empty', async () => {
  await fsp.writeFile(path.join(dir, 'data', 'videos.json'), '{broken');
  const db = await (await get('/api/state')).json();
  assert.deepEqual(db.videos, []);
  // v1 quirk: the recovery envelope has no folders key at all (dropped in JSON)
  assert.equal(db.folders, undefined);
  const quarantined = (await fsp.readdir(path.join(dir, 'data'))).filter((f) => /^videos\.json\.corrupt-\d+$/.test(f));
  assert.equal(quarantined.length, 1);
});
