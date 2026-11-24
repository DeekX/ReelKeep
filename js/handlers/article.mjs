/* ReelKeep article handler — a saved page: title, site, description, cover,
   and an opt-in reader snapshot (text blocks stored locally, sanitized by
   construction). Without a snapshot the reader shows the metadata honestly. */

import { newId, nowIso } from '../schema.mjs';
import { hostOf, parseUrl } from '../util.mjs';

export const articleHandler = {
  type: 'article',
  icon: '#i-article',
  label: (item, t) => item.source?.name || hostOf(item.url) || t('type.article'),
  sourceKey: () => 'article',
  detect(input) {
    if (input.url && parseUrl(input.url)) return 0.4; // generic page: above link, below media
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const u = parseUrl(input.url);
    const meta = input.meta || {};
    return {
      id: newId('i'),
      type: 'article',
      title: input.title || meta.title || u?.hostname || 'Article',
      url: u?.href || input.url || '',
      source: { name: input.site || meta.siteName || u?.hostname.replace(/^www\./, '') || '', domain: u?.hostname.replace(/^www\./, '') || '' },
      folderId: input.folderId || null,
      tags: input.tags || [],
      notes: input.notes || '',
      cover: input.cover || { kind: 'none', path: '', origin: 'auto' },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
      pinned: false,
      data: {
        description: meta.description || input.description || '',
        author: meta.author || '',
        publishedAt: meta.publishedAt || null,
        snapshotPath: null,
        readingTimeMin: meta.readingTimeMin ?? null,
      },
    };
  },
  searchText: (item) => [item.data?.description, item.data?.author].filter(Boolean).join(' '),
  stamp: (item, t) => (item.data?.readingTimeMin ? t('article.min', { n: item.data.readingTimeMin }) : ''),
  editExtra(container, item, ctx) {
    container.innerHTML = `<label class="field"><span>${ctx.esc(ctx.t('article.description'))}</span><textarea id="edDesc" rows="3">${ctx.esc(item.data?.description || '')}</textarea></label>`;
  },
  collectEdit(container) {
    return { data: { description: container.querySelector('#edDesc')?.value.trim() || '' } };
  },
  async openViewer(item, ctx) {
    const d = item.data || {};
    const wrap = document.createElement('div');
    wrap.className = 'articleview';
    const head = document.createElement('div');
    head.className = 'article-head';
    const site = document.createElement('span');
    site.className = 'viewer-label';
    site.textContent = item.source?.name || hostOf(item.url);
    const open = document.createElement('a');
    open.className = 'btn';
    open.href = item.url;
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = ctx.t('lb.open.short');
    head.append(site, open);
    const body = document.createElement('div');
    body.className = 'md';
    wrap.append(head, body);
    ctx.container.append(wrap);

    const renderBlocks = (blocks) => {
      body.textContent = '';
      for (const b of blocks.slice(0, 400)) {
        const tag = /^h[1-6]$/.test(b.tag) ? b.tag : b.tag === 'blockquote' ? 'blockquote' : b.tag === 'pre' ? 'pre' : b.tag === 'li' ? 'li' : 'p';
        const el = document.createElement(tag);
        el.textContent = b.text;
        body.append(el);
      }
    };

    if (d.snapshotPath) {
      try {
        const blob = await ctx.storage.getFile(d.snapshotPath);
        if (blob) renderBlocks(JSON.parse(await blob.text()).blocks || []);
      } catch {
        body.textContent = ctx.t('article.snapshot.bad');
      }
    } else if (d.description) {
      const p = document.createElement('p');
      p.textContent = d.description;
      body.append(p);
    } else {
      const p = document.createElement('p');
      p.className = 'viewer-label';
      p.textContent = ctx.t('article.nosnapshot');
      body.append(p);
    }

    const bar = document.createElement('div');
    bar.className = 'viewer-bar';
    if (!d.snapshotPath && ctx.backend === 'remote') {
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn';
      save.textContent = ctx.t('article.savecopy');
      save.onclick = async () => {
        save.disabled = true;
        try {
          const snap = await ctx.snapshot(item.url);
          const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
          const path = await ctx.storage.putFile('files/', blob);
          ctx.patch(item.id, { data: { snapshotPath: path, readingTimeMin: snap.readingTimeMin } });
          renderBlocks(snap.blocks || []);
          save.remove();
        } catch (err) {
          ctx.toast(ctx.t('article.savefail', { err: err.message }), 'err');
          save.disabled = false;
        }
      };
      bar.append(save);
    }
    wrap.append(bar);
    return null;
  },
};
