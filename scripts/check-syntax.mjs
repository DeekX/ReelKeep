/* Dev/CI lint: syntax-check every script without dependencies.
   .mjs and CJS .js use `node --check`; app.js is ESM syntax in a .js file
   (browser module entry), so it is checked as a module via stdin. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(mjs|js)$/.test(e.name)) yield p;
  }
}

const files = [
  path.join(ROOT, 'server.js'),
  path.join(ROOT, 'i18n.js'),
  ...walk(path.join(ROOT, 'js')),
  ...walk(path.join(ROOT, 'lib')),
  ...walk(path.join(ROOT, 'test')),
  ...walk(path.join(ROOT, 'scripts')),
];

let failed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✖ ${rel}\n${r.stderr}`);
  }
}
// app.js is ESM syntax in a .js file (browser module entry) — check via stdin
const app = spawnSync(process.execPath, ['--input-type=module', '--check'], {
  input: fs.readFileSync(path.join(ROOT, 'app.js')),
  encoding: 'utf8',
});
if (app.status !== 0) {
  failed++;
  console.error(`✖ app.js\n${app.stderr}`);
}

if (failed) {
  console.error(`${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`syntax ok: ${files.length + 1} files`);
