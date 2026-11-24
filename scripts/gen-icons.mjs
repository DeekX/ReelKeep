/* Dev tool: rasterize icons/icon.svg (the project mark) into the PNG sizes the
   PWA manifest and the extension need. Zero dependencies — uses the installed
   Chrome/Edge over CDP, exactly like scripts/screenshot.mjs.
   Run: node scripts/gen-icons.mjs   (Node 18+, Chrome/Edge installed) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SVG = path.join(ROOT, 'icons', 'icon.svg');
const OUT = path.join(ROOT, 'icons');
const SIZES = [16, 32, 48, 128, 192, 512];

const candidates = [
  process.env.CHROME_PATH,
  `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
].filter(Boolean);
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge not found — set CHROME_PATH to rasterize icons.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-icons-'));
const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-icons-work-'));
const browser = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank',
]);
browser.stderr.on('data', () => {});

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 1;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = (expression) => send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return { send, evaluate, close: () => ws.close() };
}

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 60 && !fs.existsSync(portFile); i++) await sleep(200);
  const port = Number((await fsp.readFile(portFile, 'utf8')).split('\n')[0]);
  const svgUrl = pathToFileURL(SVG).href;

  async function render(size, file, opaque) {
    const wrapper = path.join(work, `w-${size}-${opaque ? 'm' : 't'}.html`);
    await fsp.writeFile(
      wrapper,
      `<body style="margin:0;${opaque ? 'background:#1b1b22;' : ''}"><img src="${svgUrl}" width="${size}" height="${size}" style="display:block">`,
    );
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pathToFileURL(wrapper).href)}`, { method: 'PUT' })).json();
    const tab = await connect(target.webSocketDebuggerUrl);
    await tab.send('Page.enable');
    await tab.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
    if (!opaque) await tab.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await tab.evaluate(`document.images[0].decode().then(() => true)`);
    await sleep(120);
    const { data } = await tab.send('Page.captureScreenshot', { format: 'png' });
    await fsp.writeFile(path.join(OUT, file), Buffer.from(data, 'base64'));
    console.log(`  icons/${file}`);
    tab.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  }

  for (const size of SIZES) await render(size, `icon-${size}.png`, false);
  // maskable: full-bleed tile; the bookmark glyph sits inside the 80% safe zone
  await render(512, 'maskable-512.png', true);
  console.log('icons rasterized from icons/icon.svg');
} finally {
  browser.kill();
  await sleep(300);
  await fsp.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await fsp.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
