/* Dev tool: assemble load-unpacked extension builds from one source.
   dist/extension-chrome  — MV3 service worker
   dist/extension-firefox — MV3 event page + gecko id
   Both bundle i18n.js and the icons; no bundler, no remote code. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

for (const [name, manifest] of [
  ['extension-chrome', 'manifest.json'],
  ['extension-firefox', 'manifest.firefox.json'],
]) {
  const out = path.join(DIST, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    if (f === 'manifest.json' || f === 'manifest.firefox.json' || f === 'store' || f.endsWith('.md')) continue;
    fs.copyFileSync(path.join(SRC, f), path.join(out, f));
  }
  fs.copyFileSync(path.join(SRC, manifest), path.join(out, 'manifest.json'));
  fs.copyFileSync(path.join(ROOT, 'i18n.js'), path.join(out, 'i18n.js'));
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    fs.copyFileSync(path.join(ROOT, 'icons', `icon-${size}.png`), path.join(out, 'icons', `icon-${size}.png`));
  }
  console.log(`dist/${name} ready — load unpacked from chrome://extensions or about:debugging`);
}
