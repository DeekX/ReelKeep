/* ReelKeep note handler — Markdown written inside the app, rendered by DOM
   construction (js/markdown.mjs), never innerHTML with user text. */

import { newId, nowIso } from '../schema.mjs';
import { renderMarkdown } from '../markdown.mjs';

export const noteHandler = {
  type: 'note',
  icon: '#i-note',
  covers: false,
  label: (item, t) => t('type.note'),
  sourceKey: () => 'note',
  detect(input) {
    if (input.text && String(input.text).trim() && !/^https?:\/\//i.test(String(input.text).trim())) return 0.5;
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const body = String(input.body || '');
    const firstLine = body.split('\n').find((l) => l.trim()) || '';
    return {
      id: newId('i'),
      type: 'note',
      title: input.title || firstLine.replace(/^#{1,6}\s*/, '').slice(0, 80) || 'Note',
      url: '',
      source: { name: '', domain: '' },
      folderId: input.folderId || null,
      tags: input.tags || [],
      notes: input.notes || '',
      cover: { kind: 'none', path: '', origin: 'auto' },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
      pinned: false,
      data: { body, format: 'markdown' },
    };
  },
  searchText: (item) => item.data?.body || '',
  stamp: () => '',
  editExtra(container, item, ctx) {
    container.innerHTML = `<label class="field"><span>${ctx.esc(ctx.t('note.body'))}</span><textarea id="edBody" rows="10" class="mono" spellcheck="false">${ctx.esc(item.data?.body || '')}</textarea></label>`;
  },
  collectEdit(container) {
    return { data: { body: container.querySelector('#edBody')?.value || '' } };
  },
  openViewer(item, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'noteview';
    const body = document.createElement('div');
    body.className = 'md';
    renderMarkdown(item.data?.body || '', body);
    const bar = document.createElement('div');
    bar.className = 'viewer-bar';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn';
    edit.textContent = ctx.t('note.edit');
    edit.onclick = () => ctx.openEdit(item.id);
    bar.append(edit);
    wrap.append(body, bar);
    ctx.container.append(wrap);
    return null;
  },
};
