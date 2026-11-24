/* Integration: every item type round-trips through the universal API;
   viewer-safe inline serving vs attachment downloads. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-types-'));
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

const json = (p, method, body) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('all eight types: add, search-shape, patch, move, delete', async () => {
  const types = [
    { type: 'video', title: 'V', url: 'https://youtu.be/aqz-KE-bpKQ', data: { kind: 'embed', provider: 'youtube', videoId: 'aqz-KE-bpKQ' } },
    { type: 'article', title: 'A', url: 'https://x.com/p', data: { description: 'desc' } },
    { type: 'image', title: 'I', url: 'https://x.com/a.png', data: { imageUrl: 'https://x.com/a.png' } },
    { type: 'audio', title: 'S', url: 'https://x.com/a.mp3', data: { fileUrl: 'https://x.com/a.mp3', progress: null } },
    { type: 'pdf', title: 'P', url: 'https://x.com/a.pdf', data: { fileUrl: 'https://x.com/a.pdf' } },
    { type: 'note', title: 'N', url: '', data: { body: '# N\n\nbody', format: 'markdown' } },
    { type: 'file', title: 'F', url: '', data: { filePath: 'files/x.zip', size: 10, mime: 'application/zip' } },
    { type: 'link', title: 'L', url: 'https://x.com/', data: { description: '' } },
  ];
  const ids = [];
  for (const t of types) {
    const res = await json('/api/items', 'POST', t);
    assert.equal(res.status, 201, t.type);
    const { item } = await res.json();
    assert.equal(item.type, t.type);
    assert.ok(item.id);
    ids.push(item.id);
  }
  const { library } = await (await fetch(`${base}/api/library`)).json();
  for (const t of types) assert.ok(library.items.some((i) => i.type === t.type), t.type);
  // legacy surface only exposes videos
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.videos.length, 1);

  // patch note body (data merge) and audio progress
  const noteId = ids[5];
  const patched = await (await json(`/api/items/${noteId}`, 'PATCH', { data: { body: '# N2' }, title: 'N2' })).json();
  assert.equal(patched.item.data.body, '# N2');
  assert.equal(patched.item.title, 'N2');
  const audioId = ids[3];
  await json(`/api/items/${audioId}`, 'PATCH', { data: { progress: 42 } });
  const lib2 = await (await fetch(`${base}/api/library`)).json();
  assert.equal(lib2.library.items.find((i) => i.id === audioId).data.progress, 42);

  // folder + move across types
  const { folder } = await (await json('/api/folders', 'POST', { name: 'Mixed' })).json();
  const moved = await json('/api/items/move', 'POST', { ids, folderId: folder.id });
  assert.equal((await moved.json()).moved, ids.length);

  // delete each type
  for (const id of ids) assert.equal((await fetch(`${base}/api/items/${id}`, { method: 'DELETE' })).status, 200);
  const lib3 = await (await fetch(`${base}/api/library`)).json();
  assert.equal(lib3.library.items.length, 0);
});

test('pdf serves inline for the sandboxed viewer, other files as attachment', async () => {
  const up = await fetch(`${base}/api/files?dir=files`, { method: 'POST', headers: { 'X-File-Name': 'doc.pdf' }, body: Buffer.from('%PDF-1.4 test') });
  const { path: rel } = await up.json();
  const inline = await fetch(`${base}/${rel}?inline=1`);
  assert.equal(inline.headers.get('content-type'), 'application/pdf');
  assert.equal(inline.headers.get('content-disposition'), null);
  const plain = await fetch(`${base}/${rel}`);
  assert.equal(plain.headers.get('content-disposition'), 'attachment');
  // inline must never enable web content
  const htmlUp = await fetch(`${base}/api/files?dir=files`, { method: 'POST', headers: { 'X-File-Name': 'x.txt' }, body: Buffer.from('<html>x</html>') });
  assert.equal(htmlUp.status, 415);
});
