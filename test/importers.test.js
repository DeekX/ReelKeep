/* Importer parsers: fixtures for every supported format, hostile input safe. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('bookmarks HTML: titles, entities, folders as tags, epoch dates, bad schemes skipped', async () => {
  const { parseBookmarksHtml } = await load('js/importers.mjs');
  const out = parseBookmarksHtml(fixture('bookmarks.html'));
  assert.equal(out.items.length, 3);
  assert.equal(out.errors.length, 1);
  const [bb, art, plain] = out.items;
  assert.equal(bb.title, 'Big Buck Bunny');
  assert.deepEqual(bb.tags.sort(), ['Watch later', 'blender', 'open-movie'].sort());
  assert.equal(bb.createdAt, new Date(1600000001 * 1000).toISOString());
  assert.equal(art.url, 'https://example.com/article?x=1&y=2');
  assert.equal(art.title, 'An & article');
  assert.equal(plain.title, 'Plain');
});

test('raindrop CSV: quoted commas, embedded newlines, folders, tags, dates', async () => {
  const { parseRaindropCsv } = await load('js/importers.mjs');
  const out = parseRaindropCsv(fixture('raindrop.csv'));
  assert.equal(out.items.length, 3);
  assert.equal(out.items[0].title, 'Rain, drop');
  assert.equal(out.items[0].notes, 'my note');
  assert.deepEqual(out.items[0].tags.sort(), ['Reading', 'tag1', 'tag2'].sort());
  assert.equal(out.items[1].title, 'Quoted, title');
  assert.equal(out.items[2].title, 'Multi line');
});

test('pocket JSON and HTML variants', async () => {
  const { parsePocket, parseBookmarksHtml } = await load('js/importers.mjs');
  const j = parsePocket(fixture('pocket.json'));
  assert.equal(j.items.length, 2);
  assert.equal(j.items[0].title, 'Pocket item');
  assert.deepEqual(j.items[0].tags, ['read']);
  const h = parsePocket(fixture('bookmarks.html'));
  assert.equal(h.items.length, 3);
  void parseBookmarksHtml;
});

test('karakeep JSON: content types, tag objects, notes', async () => {
  const { parseKarakeep } = await load('js/importers.mjs');
  const out = parseKarakeep(fixture('karakeep.json'));
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0].type, 'link');
  assert.deepEqual(out.items[0].tags, ['kara']);
  assert.equal(out.items[0].notes, 'kept');
  assert.equal(out.items[1].type, 'video');
});

test('linkwarden JSON: collection as tag, description as note', async () => {
  const { parseLinkwarden } = await load('js/importers.mjs');
  const out = parseLinkwarden(fixture('linkwarden.json'));
  assert.equal(out.items.length, 1);
  assert.deepEqual(out.items[0].tags.sort(), ['Col', 'lw'].sort());
  assert.equal(out.items[0].notes, 'desc');
});

test('youtube takeout: playlist name as tag, video urls, entries without id skipped', async () => {
  const { parseTakeout } = await load('js/importers.mjs');
  const out = parseTakeout(fixture('takeout.json'));
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].url, 'https://www.youtube.com/watch?v=eRsGyueVLvQ');
  assert.deepEqual(out.items[0].tags, ['My playlist']);
});

test('url list: comments skipped, title|url split, non-urls reported', async () => {
  const { parseUrlList } = await load('js/importers.mjs');
  const out = parseUrlList(fixture('urls.txt'));
  assert.equal(out.items.length, 2);
  assert.equal(out.items[1].title, 'Custom title');
  assert.equal(out.errors.length, 1);
});

test('format sniffing', async () => {
  const { detectFormat } = await load('js/importers.mjs');
  assert.equal(detectFormat(fixture('bookmarks.html'), 'bookmarks.html'), 'bookmarks');
  assert.equal(detectFormat(fixture('raindrop.csv'), 'raindrop.csv'), 'raindrop');
  assert.equal(detectFormat(fixture('pocket.json'), 'pocket.json'), 'pocket');
  assert.equal(detectFormat(fixture('karakeep.json'), 'k.json'), 'karakeep');
  assert.equal(detectFormat(fixture('linkwarden.json'), 'l.json'), 'linkwarden');
  assert.equal(detectFormat(fixture('takeout.json'), 't.json'), 'takeout');
  assert.equal(detectFormat(fixture('urls.txt'), 'urls.txt'), 'urls');
  assert.equal(detectFormat('{"schemaVersion":2,"items":[],"folders":[]}', 'lib.json'), 'reelkeep');
});

test('malformed inputs produce errors, never throw', async () => {
  const m = await load('js/importers.mjs');
  for (const [fn, arg] of [
    [m.parseKarakeep, '{bad'],
    [m.parseLinkwarden, '{bad'],
    [m.parseTakeout, '{bad'],
    [m.parsePocket, '{bad'],
    [m.parseRaindropCsv, ''],
    [m.parseBookmarksHtml, ''],
    [m.parseUrlList, ''],
  ]) {
    const out = fn(arg);
    assert.ok(Array.isArray(out.items) && Array.isArray(out.errors));
  }
});
