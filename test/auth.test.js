/* Auth + headers: password gate, cookie session, rate limit, unsafe-startup
   refusal, security headers. */
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

async function start(env = {}) {
  child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', ...env },
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

async function stop() {
  if (!child) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await exited;
  child = null;
}

before(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-auth-'));
  await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
  for (const f of ['server.js', 'index.html', 'player.html', 'player.js', 'player.css', 'app.js', 'styles.css', 'i18n.js']) {
    await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
  }
  for (const d of ['lib', 'js']) await fsp.cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });
  await start({ REELKEEP_PASSWORD: 'correct horse' });
});

after(async () => {
  await stop();
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('password gate: API and media require a session; UI shell stays public', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/media?url=https://example.com/a.mp4`)).status, 401);
  assert.equal((await fetch(`${base}/index.html`)).status, 200);
  const sess = await (await fetch(`${base}/api/session`)).json();
  assert.deepEqual(sess, { required: true, authenticated: false });
});

test('login: wrong password 401, right password sets HttpOnly SameSite=Strict cookie', async () => {
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) });
  assert.equal(bad.status, 401);
  const good = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
  assert.equal(good.status, 200);
  const cookie = good.headers.get('set-cookie');
  assert.match(cookie, /rk_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const jar = cookie.split(';')[0];
  const state = await fetch(`${base}/api/state`, { headers: { Cookie: jar } });
  assert.equal(state.status, 200);
  const sess = await (await fetch(`${base}/api/session`, { headers: { Cookie: jar } })).json();
  assert.equal(sess.authenticated, true);
  // tampered cookie is refused
  assert.equal((await fetch(`${base}/api/state`, { headers: { Cookie: jar + 'x' } })).status, 401);
  // logout clears
  const out = await fetch(`${base}/api/logout`, { method: 'POST', headers: { Cookie: jar } });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});

test('login rate limit kicks in after repeated failures', async () => {
  let last;
  for (let i = 0; i < 10; i++) {
    last = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x' }) });
  }
  assert.equal(last.status, 429);
});

test('security headers on shell and API', async () => {
  const html = await fetch(`${base}/index.html`);
  const csp = html.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/unsafe-inline/.test(csp.split('script-src')[1].split(';')[0]), 'no inline scripts');
  assert.match(csp, /object-src 'none'/);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(html.headers.get('permissions-policy'));
  const api = await fetch(`${base}/api/session`);
  assert.equal(api.headers.get('referrer-policy'), 'no-referrer');
});

test('non-loopback without password refuses to start; explicit insecure flag warns', async () => {
  await stop();
  const refuse = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '0.0.0.0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  refuse.stderr.on('data', (c) => (err += c));
  const code = await new Promise((resolve) => refuse.on('exit', resolve));
  assert.equal(code, 1);
  assert.match(err, /Refusing to start/);

  const warned = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...process.env, PORT: '0', HOST: '0.0.0.0', REELKEEP_ALLOW_INSECURE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let werr = '';
  warned.stderr.on('data', (c) => (werr += c));
  await new Promise((resolve) => warned.stdout.on('data', (c) => /http:\/\//.test(String(c)) && resolve()));
  assert.match(werr, /WARNING/);
  warned.kill();
  await new Promise((resolve) => warned.on('exit', resolve));
  await start({ REELKEEP_PASSWORD: 'correct horse' });
});
