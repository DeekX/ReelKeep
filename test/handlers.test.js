/* Unit tests: type detection, handler creation, search text, Markdown safety,
   and the export→import round-trip across every item type. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

async function registry() {
  const reg = await load('js/handlers/registry.mjs');
  const { videoHandler } = await load('js/handlers/video.mjs');
  const { articleHandler } = await load('js/handlers/article.mjs');
  const { imageHandler } = await load('js/handlers/image.mjs');
  const { audioHandler } = await load('js/handlers/audio.mjs');
  const { pdfHandler } = await load('js/handlers/pdf.mjs');
  const { noteHandler } = await load('js/handlers/note.mjs');
  const { fileHandler } = await load('js/handlers/file.mjs');
  const { linkHandler } = await load('js/handlers/link.mjs');
  for (const h of [videoHandler, articleHandler, imageHandler, audioHandler, pdfHandler, noteHandler, fileHandler, linkHandler]) {
    reg.registerHandler(h);
  }
  return reg;
}

test('type detection order: media beats page beats link; files by MIME', async () => {
  const { detectType } = await registry();
  const cases = [
    [{ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' }, 'video'],
    [{ url: 'https://example.com/story/123' }, 'article'],
    [{ url: 'https://cdn.example.com/a.mp4' }, 'video'],
    [{ url: 'https://cdn.example.com/a.mp3' }, 'audio'],
    [{ url: 'https://cdn.example.com/a.png' }, 'image'],
    [{ url: 'https://cdn.example.com/doc.pdf' }, 'pdf'],
    [{ file: { type: 'image/png', name: 'x.png' } }, 'image'],
    [{ file: { type: 'audio/mpeg', name: 'x.mp3' } }, 'audio'],
    [{ file: { type: 'application/pdf', name: 'x.pdf' } }, 'pdf'],
    [{ file: { type: 'video/mp4', name: 'x.mp4' } }, 'video'],
    [{ file: { type: 'application/zip', name: 'x.zip' } }, 'file'],
    [{ text: '# My note\n\nsome body' }, 'note'],
  ];
  for (const [input, type] of cases) assert.equal(detectType(input), type, JSON.stringify(input));
});

test('handlers create universal items with type-specific data', async () => {
  const reg = await registry();
  const note = await reg.getHandler('note').create({ body: '# Title line\n\nbody text', tags: ['t'] });
  assert.equal(note.type, 'note');
  assert.equal(note.title, 'Title line');
  assert.equal(note.data.format, 'markdown');
  assert.equal(reg.getHandler('note').searchText(note), '# Title line\n\nbody text');

  const img = await reg.getHandler('image').create({ url: 'https://x.com/a.png', path: 'files/1_a.png' });
  assert.equal(img.cover.kind, 'file');
  assert.equal(img.data.filePath, 'files/1_a.png');

  const aud = await reg.getHandler('audio').create({ url: 'https://x.com/a.mp3' });
  assert.equal(aud.data.progress, null);
  assert.equal(aud.data.fileUrl, 'https://x.com/a.mp3');

  const pdf = await reg.getHandler('pdf').create({ path: 'files/1_a.pdf' });
  assert.equal(pdf.data.filePath, 'files/1_a.pdf');

  const file = await reg.getHandler('file').create({ path: 'files/1_a.zip', fileName: 'a.zip', size: 1234, mime: 'application/zip' });
  assert.equal(file.data.size, 1234);

  const art = await reg.getHandler('article').create({ url: 'https://x.com/post', meta: { description: 'd', siteName: 'X', readingTimeMin: 3 } });
  assert.equal(art.data.description, 'd');
  assert.equal(art.data.readingTimeMin, 3);
  assert.equal(reg.getHandler('article').searchText(art), 'd');
});

/* minimal DOM stub: enough for renderMarkdown's construction-only output */
function stubDoc() {
  const el = (tag) => ({
    tag,
    children: [],
    textContent: '',
    append(...n) {
      this.children.push(...n);
    },
    setAttribute() {},
    classList: { add() {} },
    style: {},
  });
  return { createElement: el, createTextNode: (text) => ({ text }) };
}

test('Markdown renderer builds nodes, never markup; link schemes allowlisted', async () => {
  const { renderMarkdown } = await load('js/markdown.mjs');
  const doc = stubDoc();
  const root = doc.createElement('div');
  renderMarkdown('# Hi\n\nSome **bold** and `code` and [ok](https://x.com) and [bad](javascript:alert(1))\n\n- one\n- two\n\n> quote\n\n```\n<script>alert(1)</script>\n```', root, doc);
  const tags = [];
  const walk = (n) => {
    if (n.tag) tags.push(n.tag);
    (n.children || []).forEach(walk);
  };
  walk(root);
  assert.ok(!tags.includes('script'), 'no script element may be constructed');
  assert.ok(tags.includes('h1') && tags.includes('strong') && tags.includes('code') && tags.includes('ul') && tags.includes('blockquote') && tags.includes('pre'));
  // the javascript: link must degrade to plain text
  const texts = [];
  const walkText = (n) => {
    if (n.text != null) texts.push(n.text);
    if (n.textContent) texts.push(n.textContent);
    (n.children || []).forEach(walkText);
  };
  walkText(root);
  assert.ok(texts.some((t) => t.includes('bad')));
  const links = [];
  const walkLinks = (n) => {
    if (n.tag === 'a') links.push(n.href);
    (n.children || []).forEach(walkLinks);
  };
  walkLinks(root);
  assert.deepEqual(links, ['https://x.com']); // stub keeps href verbatim; browsers normalize
});

test('export → import round-trip preserves every type losslessly', async () => {
  const reg = await registry();
  const { migrateLibrary } = await load('js/migrations.mjs');
  const { validateLibrary, emptyLibrary } = await load('js/schema.mjs');
  const items = [];
  items.push(await reg.getHandler('video').create({ title: 'V', url: 'https://youtu.be/aqz-KE-bpKQ', kind: 'embed', provider: 'youtube', videoId: 'aqz-KE-bpKQ' }));
  items.push(await reg.getHandler('article').create({ url: 'https://x.com/p', meta: { description: 'd' } }));
  items.push(await reg.getHandler('image').create({ url: 'https://x.com/a.png' }));
  items.push(await reg.getHandler('audio').create({ url: 'https://x.com/a.mp3' }));
  items.push(await reg.getHandler('pdf').create({ url: 'https://x.com/a.pdf' }));
  items.push(await reg.getHandler('note').create({ body: '# N\n\nbody' }));
  items.push(await reg.getHandler('file').create({ path: 'files/1_a.zip', fileName: 'a.zip', size: 10, mime: 'application/zip' }));
  items.push(await reg.getHandler('link').create({ url: 'https://x.com/' }));
  const lib = { ...emptyLibrary('2026-11-24T00:00:00.000Z'), items, folders: [{ id: 'f_1', name: 'F', createdAt: '2026-11-24T00:00:00.000Z', order: 0 }] };
  const exported = JSON.stringify(lib);
  const imported = migrateLibrary(JSON.parse(exported), { now: '2027-01-01T00:00:00.000Z' });
  assert.equal(imported.changed, false);
  assert.equal(validateLibrary(imported.data).ok, true);
  assert.deepEqual(imported.data, lib);
});
