/* Unit tests for the shared pure modules (schema, migrations, providers, util).
   CJS wrapper so the existing suite style stays uniform; modules are ESM. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-v1.json'), 'utf8'));
const NOW = '2026-11-24T00:00:00.000Z';

test('golden v1 fixture migrates losslessly (semantic round-trip)', async () => {
  const { migrateLibrary } = await load('js/migrations.mjs');
  const { itemToLegacy, legacyFolderView, SCHEMA_VERSION } = await load('js/schema.mjs');
  const { data, changed, fromVersion } = migrateLibrary(GOLDEN, { now: NOW });
  assert.equal(changed, true);
  assert.equal(fromVersion, 1);
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  assert.equal(data.items.length, GOLDEN.videos.length);
  assert.equal(data.folders.length, GOLDEN.folders.length);
  assert.deepEqual(data.folders.map(legacyFolderView), GOLDEN.folders);
  data.items.forEach((item, i) => {
    const original = GOLDEN.videos[i];
    assert.equal(item.type, 'video');
    assert.equal(item.id, original.id);
    const back = itemToLegacy(item);
    for (const [k, val] of Object.entries(original)) {
      assert.deepEqual(back[k], val, `round-trip ${original.id}.${k}`);
    }
  });
  // unknown future fields survive the migration
  const last = data.items.find((i) => i.id === 'v_gold00000006');
  assert.deepEqual(last.futureField, { keep: 'me', nested: [1, 2, 3] });
});

test('migration is idempotent (double run changes nothing)', async () => {
  const { migrateLibrary } = await load('js/migrations.mjs');
  const once = migrateLibrary(GOLDEN, { now: NOW }).data;
  const twice = migrateLibrary(once, { now: '2027-01-01T00:00:00.000Z' });
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.data, once);
});

test('a newer schema version opens read-only, never rewritten', async () => {
  const { migrateLibrary } = await load('js/migrations.mjs');
  const future = { schemaVersion: 99, meta: {}, folders: [], items: [{ id: 'i_x', type: 'hologram' }] };
  const res = migrateLibrary(future, { now: NOW });
  assert.equal(res.readOnly, true);
  assert.equal(res.changed, false);
  assert.deepEqual(res.data, future);
});

test('unrecognizable input is flagged invalid, not crashed on', async () => {
  const { migrateLibrary } = await load('js/migrations.mjs');
  assert.equal(migrateLibrary(null).invalid, true);
  assert.equal(migrateLibrary({ foo: 1 }).invalid, true);
});

test('legacy PATCH semantics: id pinned, unknown fields preserved', async () => {
  const { legacyToItem, applyLegacyPatch, itemToLegacy } = await load('js/schema.mjs');
  const item = legacyToItem({ id: 'v_a', title: 'T', url: 'https://x.com/v', extra: { keep: 1 } }, { now: NOW });
  applyLegacyPatch(item, { id: 'v_hack', title: 'T2', thumbnail: '', thumbSource: 'auto', thumbTime: null, more: [1] });
  assert.equal(item.id, 'v_a');
  assert.equal(item.title, 'T2');
  assert.equal(item.cover.kind, 'none');
  assert.deepEqual(item.extra, { keep: 1 });
  assert.deepEqual(item.more, [1]);
  assert.equal(itemToLegacy(item).thumbnail, '');
});

test('path validation rejects traversal, absolute and drive paths', async () => {
  const { isSafeRelPath } = await load('js/schema.mjs');
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'C:/x', 'a\\b', '', 'a//b', './a', 'a/./b', 'a\0b']) {
    assert.equal(isSafeRelPath(bad), false, bad);
  }
  for (const good of ['thumbnails/a.jpg', 'videos/b.mp4', 'files/c.bin', 'a/b/c.json']) {
    assert.equal(isSafeRelPath(good), true, good);
  }
});

test('validateLibrary catches duplicate ids and unsafe covers', async () => {
  const { validateLibrary } = await load('js/schema.mjs');
  const ok = { schemaVersion: 2, folders: [], items: [{ id: 'i_a', type: 'video', cover: { kind: 'file', path: 'thumbnails/a.jpg' } }] };
  assert.equal(validateLibrary(ok).ok, true);
  assert.equal(validateLibrary({ ...ok, items: [...ok.items, { id: 'i_a', type: 'video' }] }).ok, false);
  assert.equal(validateLibrary({ ...ok, items: [{ id: 'i_b', type: 'video', cover: { kind: 'file', path: '../evil' } }] }).ok, false);
  assert.equal(validateLibrary({ items: {} }).ok, false);
});

test('provider detection (characterization of the 13 parsers)', async () => {
  const { detect } = await load('js/providers.mjs');
  const cases = [
    ['https://www.youtube.com/watch?v=aqz-KE-bpKQ', 'youtube', 'embed', 'aqz-KE-bpKQ'],
    ['https://youtu.be/aqz-KE-bpKQ', 'youtube', 'embed', 'aqz-KE-bpKQ'],
    ['https://www.youtube.com/shorts/abcdefghijk', 'youtube', 'embed', 'abcdefghijk'],
    ['https://vimeo.com/22439234', 'vimeo', 'embed', '22439234'],
    ['https://www.dailymotion.com/video/x8abcde', 'dailymotion', 'embed', 'x8abcde'],
    ['https://www.twitch.tv/videos/123456', 'twitch', 'embed', 'v123456'],
    ['https://clips.twitch.tv/SomeClipSlug', 'twitch', 'embed', 'SomeClipSlug'],
    ['https://www.tiktok.com/@user/video/7291234567890123456', 'tiktok', 'embed', '7291234567890123456'],
    ['https://x.com/user/status/1234567890', 'x', 'embed', '1234567890'],
    ['https://twitter.com/user/status/1234567890', 'x', 'embed', '1234567890'],
    ['https://www.facebook.com/watch?v=123456', 'facebook', 'embed', 'https://www.facebook.com/watch?v=123456'],
    ['https://fb.watch/abc123/', 'facebook', 'embed', 'https://fb.watch/abc123/'],
    ['https://www.instagram.com/reel/Cabc123/', 'instagram', 'embed', 'Cabc123'],
    ['https://www.loom.com/share/abc123def', 'loom', 'embed', 'abc123def'],
    ['https://home.wistia.com/medias/abc123def', 'wistia', 'embed', 'abc123def'],
    ['https://streamable.com/abc123', 'streamable', 'embed', 'abc123'],
    ['https://rutube.ru/video/abcdef0123456789abcdef01/', 'rutube', 'embed', 'abcdef0123456789abcdef01'],
    ['https://archive.org/details/BigBuckBunny_124', 'archive', 'embed', 'BigBuckBunny_124'],
    ['https://media.example.com/clip.mp4', 'file', 'file', undefined],
    ['https://example.com/some/page', 'page', 'page', undefined],
    ['not a url at all', null, 'invalid', undefined],
  ];
  for (const [url, provider, kind, videoId] of cases) {
    const d = detect(url);
    assert.equal(d.provider, provider, url);
    assert.equal(d.kind, kind, url);
    if (videoId !== undefined) assert.equal(d.videoId, videoId, url);
  }
});

test('time parsing and formatting round-trip', async () => {
  const { parseTime, fmtTime } = await load('js/util.mjs');
  assert.equal(parseTime('19:42'), 1182);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('19m42s'), 1182);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(fmtTime(1182), '19:42');
  assert.equal(fmtTime(3723), '1:02:03');
  assert.equal(fmtTime(null), '');
});

test('cleanTitle drops site chrome but keeps real titles', async () => {
  const { cleanTitle } = await load('js/providers.mjs');
  assert.equal(cleanTitle('Big Buck Bunny - YouTube', 'YouTube'), 'Big Buck Bunny');
  assert.equal(cleanTitle('Foo | SomeSite', 'SomeSite'), 'Foo');
  assert.equal(cleanTitle('YouTube', 'YouTube'), null);
  assert.equal(cleanTitle('A real title', null), 'A real title');
});
