/* Dev/CI tool: emit sea-config.json for Node's single executable application
   support. The binary embeds the whole app as assets; server.js materializes
   them at startup and keeps user data in REELKEEP_DATA (or the cwd). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function* walk(rel) {
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) yield* walk(r);
    else yield r;
  }
}

const assets = [
  'index.html',
  'player.html',
  'player.js',
  'player.css',
  'app.js',
  'styles.css',
  'i18n.js',
  'manifest.webmanifest',
  'sw.js',
  'package.json',
  'data/videos.example.json',
  ...walk('js'),
  ...walk('lib'),
  ...walk('icons'),
];
// the manifest lists what server.js materializes (package.json stays an asset
// for version lookup only)
const manifest = assets.filter((a) => a !== 'package.json');
fs.writeFileSync(path.join(ROOT, 'sea-manifest.json'), JSON.stringify(manifest, null, 2));

const config = {
  main: 'server.js',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useCodeCache: true,
  assets: Object.fromEntries([...assets, 'sea-manifest.json'].map((a) => [a, a])),
};
fs.writeFileSync(path.join(ROOT, 'sea-config.json'), JSON.stringify(config, null, 2));
console.log(`sea-config.json written (${assets.length + 1} assets)`);
