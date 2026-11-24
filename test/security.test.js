/* Security suite — SSRF ranges, pinned-IP fetch contract, CSRF origin check,
   upload sniffing, snapshot sanitization. Runs in CI; failures block releases. */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { isBlockedIp, validateUrl } = require('../lib/ssrf');
const { extractSnapshot } = require('../lib/snapshot');
const { pinnedLookup } = require('../lib/safefetch');

test('pinned lookup satisfies both dns.lookup callback shapes (Node 18 and 20+)', () => {
  const single = pinnedLookup('93.184.216.34');
  single('x.com', {}, (err, address, family) => {
    assert.equal(err, null);
    assert.equal(address, '93.184.216.34');
    assert.equal(family, 4);
  });
  const all = pinnedLookup('2606:4700::1111');
  all('x.com', { all: true }, (err, addresses) => {
    assert.equal(err, null);
    assert.deepEqual(addresses, [{ address: '2606:4700::1111', family: 6 }]);
  });
});

test('blocked IP ranges (IPv4, IPv6, mapped, metadata)', () => {
  const blocked = [
    '127.0.0.1', '127.8.9.10', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255', '0.0.0.0',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe',
  ];
  for (const ip of blocked) assert.equal(isBlockedIp(ip), true, ip);
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8'];
  for (const ip of allowed) assert.equal(isBlockedIp(ip), false, ip);
});

test('validateUrl: scheme allowlist, literal IPs, DNS results, injected resolver', async () => {
  await assert.rejects(() => validateUrl('ftp://example.com'), (e) => e.status === 400);
  await assert.rejects(() => validateUrl('file:///etc/passwd'), (e) => e.status === 400);
  await assert.rejects(() => validateUrl('http://127.0.0.1:5178/'), (e) => e.status === 403);
  await assert.rejects(() => validateUrl('http://169.254.169.254/latest/meta-data/'), (e) => e.status === 403);
  await assert.rejects(() => validateUrl('http://localhost/'), (e) => e.status === 403);
  await assert.rejects(() => validateUrl('http://printer.local/'), (e) => e.status === 403);
  // DNS name that resolves to a private address: blocked (rebinding defense)
  await assert.rejects(
    () => validateUrl('http://evil.example.com/', { resolve: async () => [{ address: '192.168.0.10', family: 4 }] }),
    (e) => e.status === 403,
  );
  // mixed answers: any private answer blocks
  await assert.rejects(
    () => validateUrl('http://mixed.example.com/', { resolve: async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }] }),
    (e) => e.status === 403,
  );
  const ok = await validateUrl('https://good.example.com/x', { resolve: async () => [{ address: '93.184.216.34', family: 4 }] });
  assert.equal(ok.ip, '93.184.216.34');
  await assert.rejects(() => validateUrl('http://nx.example.com/', { resolve: async () => [] }), (e) => e.status === 502);
});

test('snapshot extraction yields text blocks only, no markup', () => {
  const html = `<html><head><title>T</title><script>alert(1)</script></head><body>
    <nav><a href="/">Home</a></nav>
    <article><h1>Hello</h1><p>First <b>paragraph</b> with <img src=x onerror=alert(1)> entity &amp; text.</p>
    <p>Second paragraph.</p><script>evil()</script><li>ok</li></article>
    <footer>chrome</footer></body></html>`;
  const snap = extractSnapshot(html);
  assert.ok(snap.blocks.length >= 2);
  assert.equal(snap.blocks[0].tag, 'h1');
  assert.equal(snap.blocks[0].text, 'Hello');
  assert.ok(snap.blocks.some((b) => b.text.includes('First paragraph with entity & text.')));
  for (const b of snap.blocks) assert.ok(!/[<>]/.test(b.text), 'no markup survives');
  assert.ok(snap.readingTimeMin >= 1);
});

/* ---------------------------------------------------- integration */

let dir;
let child;
let base;

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-sec-'));
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

test('server-side fetches refuse internal targets (SSRF)', async () => {
  const port = new URL(base).port;
  const targets = [
    `http://127.0.0.1:${port}/api/state`,
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://100.64.0.1/',
  ];
  for (const t of targets) {
    assert.equal((await fetch(`${base}/api/enrich?url=${encodeURIComponent(t)}`)).status, 403, t);
    assert.equal((await fetch(`${base}/media?url=${encodeURIComponent(t)}`)).status, 403, t);
    assert.equal(
      (await fetch(`${base}/api/thumbnails/from-url`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: t }) })).status,
      403,
      t,
    );
    assert.equal(
      (await fetch(`${base}/api/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: t }) })).status,
      403,
      t,
    );
  }
});

test('cross-origin writes are refused; same-origin and header-less clients pass', async () => {
  const evil = await fetch(`${base}/api/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ title: 'drive-by' }),
  });
  assert.equal(evil.status, 403);
  const own = await fetch(`${base}/api/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ title: 'own origin', url: 'https://e.com/o' }),
  });
  assert.equal(own.status, 201);
  const none = await fetch(`${base}/api/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'no origin', url: 'https://e.com/n' }),
  });
  assert.equal(none.status, 201);
});

test('upload intake sniffs content: HTML posing as media or file is refused', async () => {
  const html = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
  const asFile = await fetch(`${base}/api/files?dir=files`, { method: 'POST', headers: { 'X-File-Name': 'note.txt' }, body: html });
  assert.equal(asFile.status, 415);
  const asThumb = await fetch(`${base}/api/files?dir=thumbnails`, { method: 'POST', headers: { 'X-File-Name': 'pic.png' }, body: html });
  assert.equal(asThumb.status, 415);
  const webExec = await fetch(`${base}/api/files?dir=files`, { method: 'POST', headers: { 'X-File-Name': 'page.html' }, body: Buffer.from('x') });
  assert.equal(webExec.status, 415);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const okThumb = await fetch(`${base}/api/files?dir=thumbnails`, { method: 'POST', headers: { 'X-File-Name': 'pic.png' }, body: png });
  assert.equal(okThumb.status, 201);
  const { path: rel } = await okThumb.json();
  assert.match(rel, /^thumbnails\/\d+_[\w-]{8}\.png$/);
  const served = await fetch(base + '/' + rel);
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
});

test('generic files download as attachment, never render in the app origin', async () => {
  const res = await fetch(`${base}/api/files?dir=files`, { method: 'POST', headers: { 'X-File-Name': 'doc.pdf' }, body: Buffer.from('%PDF-1.4 fake') });
  assert.equal(res.status, 201);
  const { path: rel } = await res.json();
  const served = await fetch(base + '/' + rel);
  assert.equal(served.headers.get('content-disposition'), 'attachment');
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
});
