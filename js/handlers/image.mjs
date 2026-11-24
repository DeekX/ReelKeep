/* ReelKeep image handler — URL or upload, zoom/pan viewer, cover is the image. */

import { newId, nowIso } from '../schema.mjs';
import { hostOf, parseUrl, clamp } from '../util.mjs';

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

export const imageHandler = {
  type: 'image',
  icon: '#i-image',
  label: (item, t) => t('type.image'),
  sourceKey: () => 'image',
  detect(input) {
    if (input.file) return /^image\//.test(input.file.type) ? 0.95 : 0;
    if (input.url && IMG_EXT.test(input.url)) return 0.9;
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const u = input.url ? parseUrl(input.url) : null;
    const stored = input.path || '';
    return {
      id: newId('i'),
      type: 'image',
      title: input.title || u?.hostname || 'Image',
      url: input.url || (stored ? '/' + stored : ''),
      source: { name: input.site || u?.hostname.replace(/^www\./, '') || '', domain: u?.hostname.replace(/^www\./, '') || '' },
      folderId: input.folderId || null,
      tags: input.tags || [],
      notes: input.notes || '',
      cover: stored ? { kind: 'file', path: stored, origin: 'upload' } : input.url ? { kind: 'url', path: input.url, origin: 'url' } : { kind: 'none', path: '', origin: 'auto' },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
      pinned: false,
      data: { filePath: stored, imageUrl: input.url || '', width: input.width || null, height: input.height || null },
    };
  },
  searchText: () => '',
  stamp: (item) => (item.data?.width && item.data?.height ? `${item.data.width}×${item.data.height}` : ''),
  editExtra(container, item, ctx) {
    container.innerHTML = `<label class="field"><span>${ctx.esc(ctx.t('image.url'))}</span><input id="edImgUrl" type="url" spellcheck="false" value="${ctx.esc(item.data?.imageUrl || item.url || '')}" /></label>`;
  },
  collectEdit(container) {
    return { url: (container.querySelector('#edImgUrl')?.value || '').trim(), data: { imageUrl: (container.querySelector('#edImgUrl')?.value || '').trim() } };
  },
  openViewer(item, ctx) {
    const src = item.data?.filePath ? ctx.storage.getFileUrl(item.data.filePath) : item.data?.imageUrl || item.url;
    const wrap = document.createElement('div');
    wrap.className = 'imgview';
    const img = document.createElement('img');
    img.src = src;
    img.alt = item.title || '';
    img.draggable = false;
    const bar = document.createElement('div');
    bar.className = 'viewer-bar';
    let scale = 1;
    let tx = 0;
    let ty = 0;
    const apply = () => {
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    const zoom = (f) => {
      scale = clamp(scale * f, 1, 8);
      if (scale === 1) {
        tx = 0;
        ty = 0;
      }
      apply();
    };
    for (const [label, fn] of [
      ['−', () => zoom(1 / 1.4)],
      ['+', () => zoom(1.4)],
      ['1:1', () => { scale = 1; tx = 0; ty = 0; apply(); }],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.textContent = label;
      b.onclick = fn;
      bar.append(b);
    }
    wrap.append(img, bar);
    const wheel = (e) => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2);
    };
    let drag = null;
    const down = (e) => {
      if (scale === 1) return;
      drag = { x: e.clientX - tx, y: e.clientY - ty };
      wrap.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!drag) return;
      tx = e.clientX - drag.x;
      ty = e.clientY - drag.y;
      apply();
    };
    const up = () => (drag = null);
    wrap.addEventListener('wheel', wheel, { passive: false });
    wrap.addEventListener('pointerdown', down);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', up);
    ctx.container.append(wrap);
    // record natural dimensions once, honestly
    img.addEventListener('load', () => {
      if (!item.data?.width && img.naturalWidth) {
        ctx.patch(item.id, { data: { width: img.naturalWidth, height: img.naturalHeight } }, false);
      }
    }, { once: true });
    return () => {
      wrap.removeEventListener('wheel', wheel);
      wrap.removeEventListener('pointerdown', down);
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerup', up);
    };
  },
};
