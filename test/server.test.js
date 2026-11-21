/* Smoke tests for server.js — node:test only, no dependencies. Run: npm test */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-test-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'app.js', 'styles.css']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  await fsp.copyFile(path.join(ROOT, 'data', 'videos.example.json'), path.join(dir, 'data', 'videos.example.json'));

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
  // Windows keeps directory handles briefly after process exit
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const get = (p) => fetch(base + p);
const json = (p, method, body) =>
  fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('first run seeds the example library', async () => {
  const res = await get('/api/state');
  assert.equal(res.status, 200);
  const db = await res.json();
  assert.equal(db.videos.length, 5);
});

test('serves the UI but never the library, source or repo internals', async () => {
  for (const p of ['/', '/index.html', '/player.html', '/app.js', '/styles.css']) {
    assert.equal((await get(p)).status, 200, p);
  }
  for (const p of ['/data/videos.json', '/data/videos.example.json', '/server.js', '/package.json', '/%2e%2e/server.js']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('malformed percent-encoding is a 400, not a crash', async () => {
  assert.equal((await get('/%zz')).status, 400);
});

test('create, patch and delete a video', async () => {
  const created = await json('/api/videos', 'POST', {
    title: 'Test clip',
    url: 'https://example.com/clip.mp4',
    kind: 'file',
    provider: 'file',
    tags: ['test'],
  });
  assert.equal(created.status, 201);
  const { video } = await created.json();
  assert.match(video.id, /^v_/);

  const patched = await json(`/api/videos/${video.id}`, 'PATCH', { title: 'Renamed' });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).video.title, 'Renamed');

  const state = await (await get('/api/state')).json();
  assert.ok(state.videos.some((v) => v.id === video.id && v.title === 'Renamed'));

  assert.equal((await fetch(`${base}/api/videos/${video.id}`, { method: 'DELETE' })).status, 200);
  const after = await (await get('/api/state')).json();
  assert.ok(!after.videos.some((v) => v.id === video.id));
});

test('deleting a video removes its stored cover file', async () => {
  const thumbRes = await json('/api/thumbnails', 'POST', { dataUrl: PNG_1PX });
  assert.equal(thumbRes.status, 201);
  const { thumbnail } = await thumbRes.json();
  const thumbPath = path.join(dir, thumbnail);
  assert.ok(fs.existsSync(thumbPath));

  const { video } = await (await json('/api/videos', 'POST', { title: 'With cover', thumbnail })).json();
  await fetch(`${base}/api/videos/${video.id}`, { method: 'DELETE' });
  assert.ok(!fs.existsSync(thumbPath));
});

test('uploads land in videos/ with a media extension and support range requests', async () => {
  const bytes = Buffer.from('fake mp4 payload for range testing');
  const res = await fetch(`${base}/api/videos/upload`, {
    method: 'POST',
    headers: { 'X-File-Name': 'clip.html' },
    body: bytes,
  });
  assert.equal(res.status, 201);
  const up = await res.json();
  assert.match(up.fileName, /\.mp4$/, 'non-media extensions must fall back to .mp4');
  assert.equal(up.size, bytes.length);

  const whole = await get(up.fileUrl);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), bytes);

  const part = await fetch(base + up.fileUrl, { headers: { Range: 'bytes=0-3' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-3/${bytes.length}`);
  assert.equal((await part.text()).length, 4);
});

test('rejects unusable enrich and media targets', async () => {
  assert.equal((await get('/api/enrich?url=ftp://example.com')).status, 400);
  assert.equal((await get('/media?url=not-a-url')).status, 400);
  assert.equal((await get('/api/nope')).status, 404);
});

test('a corrupt library file is quarantined, not fatal', async () => {
  await fsp.writeFile(path.join(dir, 'data', 'videos.json'), '{ this is not json');
  const res = await get('/api/state');
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).videos, []);
  const backups = (await fsp.readdir(path.join(dir, 'data'))).filter((f) => f.includes('.corrupt-'));
  assert.equal(backups.length, 1);
});
