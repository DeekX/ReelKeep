/* Refresh the README screenshots from the running app — dev tool, not shipped.
   Usage: node server.js (in another window), then: npm run screenshot
   Needs Node 22+ (global WebSocket) and an installed Chrome/Chromium/Edge.
   Override the browser with CHROME_PATH and the app with REELKEEP_URL. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.REELKEEP_URL || 'http://127.0.0.1:5178';
const OUT = path.join(ROOT, 'docs');

if (typeof WebSocket === 'undefined') {
  console.error('screenshot.mjs needs Node 22+ (built-in WebSocket).');
  process.exit(1);
}

const candidates = [
  process.env.CHROME_PATH,
  process.platform === 'win32' && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  process.platform === 'win32' && `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  process.platform === 'win32' && `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  process.platform === 'darwin' && '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.platform === 'linux' && 'google-chrome',
  process.platform === 'linux' && 'chromium',
].filter(Boolean);
const chrome = candidates.find((p) => {
  try {
    return fs.existsSync(p) || p === 'google-chrome' || p === 'chromium';
  } catch {
    return false;
  }
});
if (!chrome) {
  console.error('No Chrome/Chromium/Edge found. Set CHROME_PATH to the browser executable.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'reelkeep-shot-'));
const browser = spawn(chrome, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--hide-scrollbars',
  '--window-size=1456,900',
  '--force-device-scale-factor=1',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank',
]);
browser.stderr.on('data', () => {});

try {
  const portFile = path.join(profile, 'DevToolsActivePort');
  await waitFor(() => fs.existsSync(portFile), 15000, 'browser devtools port');
  const port = Number((await fsp.readFile(portFile, 'utf8')).split('\n')[0]);

  let wsUrl;
  await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    wsUrl = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    return !!wsUrl;
  }, 10000, 'a page target');

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('devtools websocket failed'));
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page eval failed');
    return r.result.value;
  };
  const shoot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await fsp.writeFile(path.join(OUT, name), Buffer.from(data, 'base64'));
    console.log(`  docs/${name}`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: APP });
  await waitFor(() => evaluate(`document.querySelectorAll('.card').length > 0`), 15000, 'gallery cards');
  await waitFor(() => evaluate(`Array.from(document.images).every((i) => i.complete)`), 20000, 'covers loaded');
  await sleep(700); // let the card entrance animation settle
  await shoot('screenshot-grid.png');

  // The built-in file player, mid-film, with its chrome visible.
  await evaluate(`openPlayer('v_ex0000000002')`);
  await waitFor(
    () =>
      evaluate(`(() => {
        const v = document.getElementById('lbFrame').contentDocument?.getElementById('v');
        return !!v && v.readyState >= 2 && v.currentTime >= 25;
      })()`),
    40000,
    'file player seeked into the film',
  );
  // pause so the native control bar is visible in the shot
  await evaluate(`document.getElementById('lbFrame').contentDocument.getElementById('v').pause()`);
  await sleep(600);
  await shoot('screenshot-player.png');

  // The frame picker: scrub bar, live preview canvas, timestamp controls.
  await evaluate(`closePlayer(); openThumbPicker('v_ex0000000002')`);
  await waitFor(() => evaluate(`typeof thumbVideoReady !== 'undefined' && thumbVideoReady`), 30000, 'frame picker ready');
  await sleep(1500); // seek + canvas draw
  await shoot('screenshot-frames.png');

  ws.close();
} finally {
  browser.kill();
  await fsp.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
