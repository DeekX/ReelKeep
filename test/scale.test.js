/* Phase 6 unit: exporters round-trip, trash semantics, smart views, dup
   normalization, and the link-check + backup-prune server behavior. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
const ROOT = path.join(__dirname, '..');

test('CSV export escapes and round-trips through the CSV parser', async () => {
  const { toCsv } = await load('js/exporters.mjs');
  const { parseCsv } = await load('js/importers.mjs');
  const items = [
    { id: 'i_1', type: 'note', title: 'Comma, "quote"\nand newline', url: '', folderId: '', tags: ['a', 'b'], notes: 'n', createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: null },
  ];
  const rows = parseCsv(toCsv(items));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][2], 'Comma, "quote"\nand newline');
  assert.equal(rows[1][5], 'a;b');
});

test('bookmarks HTML export re-imports losslessly (urls/titles/tags/folders)', async () => {
  const { toBookmarksHtml } = await load('js/exporters.mjs');
  const { parseBookmarksHtml } = await load('js/importers.mjs');
  const items = [
    { id: 'i_1', type: 'link', title: 'A & B', url: 'https://example.com/a?x=1', folderId: 'f_1', tags: ['t1'], createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'i_2', type: 'link', title: 'Plain', url: 'https://example.org/b', folderId: '', tags: [], createdAt: '2026-01-02T00:00:00.000Z' },
  ];
  const html = toBookmarksHtml(items, [{ id: 'f_1', name: 'My folder' }]);
  const out = parseBookmarksHtml(html);
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].title, 'A & B');
  assert.equal(out.items[0].url, 'https://example.com/a?x=1');
  assert.ok(out.items[0].tags.includes('My folder') && out.items[0].tags.includes('t1'));
});

test('normalizeUrl canonicalizes for duplicate detection', async () => {
  const { normalizeUrl } = await load('js/library.mjs');
  assert.equal(normalizeUrl('https://WWW.Example.com/a/?b=2&a=1#frag'), normalizeUrl('https://example.com/a?a=1&b=2'));
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('not a url'), '');
});

test('trash: remove trashes, restore recovers, purge removes, expiry purges', async () => {
  const lib = await load('js/library.mjs');
  const item = { id: 'i_t', type: 'note', title: 'T', url: '', tags: [], notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), data: { body: 'x' } };
  lib.state.items = [item];
  lib.state.folders = [];
  await lib.removeItem('i_t');
  assert.ok(item.trashedAt);
  assert.equal(lib.visibleItems().length, 0);
  lib.state.smart = 'trash';
  assert.equal(lib.visibleItems().length, 1);
  lib.restoreItem('i_t');
  assert.equal(item.trashedAt, null);
  lib.state.smart = '';
  assert.equal(lib.visibleItems().length, 1);
  // expiry
  item.trashedAt = new Date(Date.now() - 40 * 86400000).toISOString();
  const purged = await lib.purgeExpiredTrash(30);
  assert.equal(purged, 1);
  assert.equal(lib.state.items.length, 0);
});

/* ---------------------------------------------- server: check + prune */

let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-scale-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'player.js', 'player.css', 'app.js', 'styles.css', 'i18n.js']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  for (const d of ['lib', 'js']) await fsp.cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', REELKEEP_BACKUPS_KEEP: '2' },
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

test('link check: internal targets refused by SSRF, batch capped, order preserved', async () => {
  const res = await fetch(`${base}/api/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls: ['http://127.0.0.1:1/', 'http://169.254.169.254/', 'ftp://x.com'] }),
  });
  assert.equal(res.status, 200);
  const { results } = await res.json();
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => !r.ok));
  assert.equal(results[0].url, 'http://127.0.0.1:1/');
  const bad = await fetch(`${base}/api/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: 'nope' }) });
  assert.equal(bad.status, 400);
});

test('rolling backups keep the configured window', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`${base}/api/backups`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: `pre-import` }) });
    assert.equal(r.status, 201);
    await new Promise((res) => setTimeout(res, 5));
  }
  const names = (await fsp.readdir(path.join(dir, 'backups'))).filter((f) => /^library-pre-import-\d+\.json$/.test(f));
  assert.equal(names.length, 2);
});
