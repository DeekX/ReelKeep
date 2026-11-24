/* Unit: multi-tab merge semantics and revision counter. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', rel)).href);

const item = (id, updatedAt, title) => ({
  id,
  type: 'note',
  title,
  url: '',
  source: { name: '', domain: '' },
  folderId: null,
  tags: [],
  notes: '',
  cover: { kind: 'none', path: '', origin: 'auto' },
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt,
  lastOpenedAt: null,
  openCount: 0,
  pinned: false,
  data: { body: 'x', format: 'markdown' },
});

test('merge: newer updatedAt wins, local additions survive, local deletions stay deleted', async () => {
  const lib = await load('js/library.mjs');
  lib.state.items = [item('i_a', '2026-11-24T10:00:00.000Z', 'local newer'), item('i_b', '2026-11-24T09:00:00.000Z', 'local older'), item('i_new', '2026-11-24T10:00:00.000Z', 'local only')];
  lib.state.folders = [{ id: 'f_local', name: 'L', createdAt: '2026-11-24T00:00:00.000Z', order: 0 }];
  lib.state.deleted = new Set(['i_gone']);
  lib.state.rev = 3;
  const remote = {
    rev: 4,
    items: [item('i_a', '2026-11-24T09:00:00.000Z', 'remote older'), item('i_b', '2026-11-24T11:00:00.000Z', 'remote newer'), item('i_gone', '2026-11-24T08:00:00.000Z', 'deleted locally'), item('i_remote', '2026-11-24T08:00:00.000Z', 'remote only')],
    folders: [{ id: 'f_remote', name: 'R', createdAt: '2026-11-24T00:00:00.000Z', order: 0 }],
  };
  lib.mergeRemote(remote);
  const byId = Object.fromEntries(lib.state.items.map((i) => [i.id, i]));
  assert.equal(byId.i_a.title, 'local newer');
  assert.equal(byId.i_b.title, 'remote newer');
  assert.ok(byId.i_new, 'local addition survives');
  assert.ok(byId.i_remote, 'remote addition survives');
  assert.ok(!byId.i_gone, 'local deletion is not resurrected');
  assert.equal(lib.state.rev, 4);
  assert.equal(lib.state.deleted.size, 0);
  assert.ok(lib.state.folders.some((f) => f.id === 'f_local') && lib.state.folders.some((f) => f.id === 'f_remote'));
});

test('snapshot bumps the revision; init reads it back', async () => {
  const lib = await load('js/library.mjs');
  lib.state.rev = 7;
  assert.equal(lib.snapshot().rev, 8);
});

test('tag filter is multi-select with match-all semantics', async () => {
  const lib = await load('js/library.mjs');
  const mk = (id, tags) => ({ id, type: 'note', title: id, url: '', tags, notes: '', createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z', data: { body: 'x' } });
  lib.state.items = [mk('i_ab', ['a', 'b']), mk('i_a', ['a']), mk('i_b', ['b']), mk('i_none', [])];
  lib.state.folders = [];
  lib.state.tags = new Set(['a']);
  assert.deepEqual(lib.visibleItems().map((i) => i.id), ['i_ab', 'i_a']);
  lib.state.tags = new Set(['a', 'b']);
  assert.deepEqual(lib.visibleItems().map((i) => i.id), ['i_ab']);
  lib.state.tags = new Set();
  assert.equal(lib.visibleItems().length, 4);
});
