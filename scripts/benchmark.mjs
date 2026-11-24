/* Dev/CI benchmark: 10,000-item library through the real app in headless Chrome.
   Measures boot-to-cards and search-to-render; fails over documented budgets.
   Usage: node scripts/benchmark.mjs   (needs Chrome/Edge; zero dependencies) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.env.BENCH_N || 10000);
const BUDGET_BOOT_MS = Number(process.env.BENCH_BOOT_MS || 6000);
const BUDGET_SEARCH_MS = Number(process.env.BENCH_SEARCH_MS || 400);

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-bench-'));
await fsp.mkdir(path.join(dir, 'data'), { recursive: true });
for (const f of ['server.js', 'index.html', 'player.html', 'player.js', 'player.css', 'app.js', 'styles.css', 'i18n.js', 'manifest.webmanifest', 'sw.js']) {
  await fsp.copyFile(path.join(ROOT, f), path.join(dir, f));
}
for (const d of ['lib', 'js', 'icons']) await fsp.cp(path.join(ROOT, d), path.join(dir, d), { recursive: true });

// seeded library: mixed types, searchable titles/tags
const items = [];
for (let i = 0; i < N; i++) {
  const type = ['link', 'note', 'video', 'article'][i % 4];
  items.push({
    id: `i_b${i}`,
    type,
    title: `Item ${i} ${i % 97 === 0 ? 'zebrafish' : 'common'} topic-${i % 31}`,
    url: type === 'note' ? '' : `https://example.com/item/${i}`,
    source: { name: 'example.com', domain: 'example.com' },
    folderId: i % 5 === 0 ? 'f_b1' : null,
    tags: [`tag${i % 17}`, `tag${i % 7}`],
    notes: i % 13 === 0 ? 'a note about something' : '',
    cover: { kind: 'none', path: '', origin: 'auto' },
    createdAt: new Date(Date.now() - i * 60000).toISOString(),
    updatedAt: new Date(Date.now() - i * 60000).toISOString(),
    lastOpenedAt: i % 11 === 0 ? new Date(Date.now() - i * 30000).toISOString() : null,
    openCount: 0,
    pinned: false,
    data: type === 'note' ? { body: `# Item ${i}\n\nbody text`, format: 'markdown' } : type === 'video' ? { kind: 'page', provider: 'page', startAt: 0, duration: null } : { description: '' },
  });
}
const lib = {
  schemaVersion: 2,
  meta: { createdAt: new Date().toISOString(), app: 'reelkeep', appVersion: 'bench' },
  rev: 1,
  folders: [{ id: 'f_b1', name: 'Bench folder', createdAt: new Date().toISOString(), order: 0 }],
  items,
};
await fsp.writeFile(path.join(dir, 'data', 'library.json'), JSON.stringify(lib));

const server = spawn(process.execPath, ['server.js'], {
  cwd: dir,
  env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 20000);
  let out = '';
  server.stdout.on('data', (c) => {
    out += c;
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  });
  server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});
const base = `http://127.0.0.1:${port}`;

const candidates = [
  process.env.CHROME_PATH,
  `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('no Chrome/Edge found');
  server.kill();
  process.exit(1);
}
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-bench-profile-'));
const browser = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--mute-audio', '--window-size=1456,900', 'about:blank']);
browser.stderr.on('data', () => {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 60 && !fs.existsSync(portFile); i++) await sleep(200);
  const cdpPort = Number((await fsp.readFile(portFile, 'utf8')).split('\n')[0]);
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(base)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');

  const t0 = Date.now();
  await send('Page.navigate', { url: base });
  let bootMs = -1;
  for (let i = 0; i < 200; i++) {
    if ((await evaluate(`document.querySelectorAll('.card').length`)) > 0) {
      bootMs = Date.now() - t0;
      break;
    }
    await sleep(50);
  }
  const cards = await evaluate(`document.querySelectorAll('.card').length`);
  const total = await evaluate(`ReelKeep.state.items.length`);

  // search: type a rare token, measure until the grid reflects it
  const t1 = Date.now();
  await evaluate(`(() => { const s = document.getElementById('search'); s.value = 'zebrafish'; s.dispatchEvent(new Event('input')); })()`);
  let searchMs = -1;
  for (let i = 0; i < 100; i++) {
    // the count line gains "· N shown" once the filtered render lands
    if (await evaluate(`/shown/.test(document.getElementById('count').textContent)`)) {
      searchMs = Date.now() - t1;
      break;
    }
    await sleep(20);
  }
  const hits = await evaluate(`ReelKeep.state.items.filter(i => i.title.includes('zebrafish')).length`);

  console.log(`items: ${total}`);
  console.log(`boot-to-cards: ${bootMs} ms (budget ${BUDGET_BOOT_MS})`);
  console.log(`search-to-render: ${searchMs} ms for ${hits} hits (budget ${BUDGET_SEARCH_MS})`);
  const ok = bootMs > 0 && bootMs <= BUDGET_BOOT_MS && searchMs > 0 && searchMs <= BUDGET_SEARCH_MS;
  console.log(ok ? 'BENCHMARK PASS' : 'BENCHMARK FAIL');
  ws.close();
  process.exitCode = ok ? 0 : 1;
} finally {
  browser.kill();
  server.kill();
  await sleep(300);
  await fsp.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fsp.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
