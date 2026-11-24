/* ReelKeep generic file handler — any upload: icon, name, size, MIME, hash;
   download or open. Never rendered as HTML in the app origin. */

import { newId, nowIso } from '../schema.mjs';
import { fmtBytes } from '../util.mjs';

export const fileHandler = {
  type: 'file',
  icon: '#i-file',
  covers: false,
  label: (item, t) => t('type.file'),
  sourceKey: () => 'file',
  detect(input) {
    if (input.file) return 0.2; // fallback below every specific type
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const stored = input.path || '';
    let hash = '';
    if (input.blob && input.blob.size <= 50 * 1024 * 1024 && globalThis.crypto?.subtle) {
      try {
        const digest = await crypto.subtle.digest('SHA-256', await input.blob.arrayBuffer());
        hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch {
        /* hash is best-effort */
      }
    }
    return {
      id: newId('i'),
      type: 'file',
      title: input.title || input.fileName || 'File',
      url: stored ? '/' + stored : '',
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
      data: { filePath: stored, size: input.size ?? null, mime: input.mime || '', hash },
    };
  },
  searchText: (item) => item.data?.mime || '',
  stamp: (item) => fmtBytes(item.data?.size),
  openViewer(item, ctx) {
    const d = item.data || {};
    const wrap = document.createElement('div');
    wrap.className = 'fileview';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('fileview-icon');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-file');
    icon.append(use);
    const name = document.createElement('b');
    name.textContent = item.title || '';
    const meta = document.createElement('span');
    meta.className = 'viewer-label';
    meta.textContent = [d.mime, fmtBytes(d.size)].filter(Boolean).join(' · ');
    const bar = document.createElement('div');
    bar.className = 'viewer-bar';
    const url = ctx.storage.getFileUrl(d.filePath);
    const dl = document.createElement('a');
    dl.className = 'btn primary';
    dl.href = url;
    dl.download = item.title || 'file';
    dl.textContent = ctx.t('file.download');
    const open = document.createElement('a');
    open.className = 'btn';
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = ctx.t('file.open');
    bar.append(dl, open);
    wrap.append(icon, name, meta, bar);
    ctx.container.append(wrap);
    return null;
  },
};
