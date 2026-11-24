/* ReelKeep extension handoff — accepts saves from the browser extension.
   Two channels, both origin-pinned: postMessage from a library tab (the
   extension injects with targetOrigin = this origin) and a #reelkeep-save=
   hash payload when the extension had to open the library. */

import { state, addItem, createFolder, copyCover, patch } from './library.mjs';
import { detect } from './providers.mjs';
import { detectType } from './handlers/registry.mjs';
import { toast } from './ui.mjs';

export async function acceptExtPayload(p) {
  if (!p || typeof p !== 'object') return null;
  const url = String(p.url || '');
  let type = p.type && p.type !== 'auto' ? p.type : detectType({ url, text: p.body });
  if (p.body && !url) type = 'note';
  const folderId = p.folderName
    ? state.folders.find((f) => f.name === p.folderName)?.id || createFolder(String(p.folderName).slice(0, 60)).id
    : '';
  const common = {
    title: String(p.title || '').slice(0, 300),
    tags: Array.isArray(p.tags) ? p.tags.slice(0, 12).map(String) : [],
    notes: String(p.notes || '').slice(0, 5000),
    folderId,
    site: String(p.siteName || ''),
  };
  let input;
  if (type === 'note') {
    input = { ...common, type: 'note', body: String(p.body || '').slice(0, 100000) };
  } else if (type === 'video') {
    const d = detect(url);
    input = {
      ...common,
      type: 'video',
      url,
      kind: d.kind === 'invalid' ? 'page' : d.kind,
      provider: d.provider || 'page',
      videoId: d.videoId || null,
      embedUrl: '',
      fileUrl: d.kind === 'file' ? url : '',
      startAt: Number(p.playbackTime) || 0,
      thumbnail: p.image || '',
      thumbSource: p.image ? 'page-image' : 'auto',
      thumbTime: null,
      favicon: '',
      duration: p.duration ?? null,
      addedAt: new Date().toISOString(),
    };
  } else {
    input = {
      ...common,
      type,
      url,
      meta: { description: p.description || null, siteName: p.siteName || null },
      cover: p.image ? { kind: 'url', path: String(p.image), origin: 'url' } : undefined,
    };
  }
  const item = await addItem(input);
  // copy a hotlinked cover locally when the companion can do it
  if (p.image && state.backend === 'remote' && item.cover?.kind === 'url') {
    const stored = await copyCover(String(p.image), url || undefined);
    if (stored !== p.image) patch(item.id, { thumbnail: stored, thumbSource: 'page-image' }, false);
  }
  toast(t('to.extsaved', { title: item.title }), 'ok');
  return item;
}

export function initHandoff() {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return; // explicit origin allowlist: ourselves only
    const d = e.data;
    if (!d || d.from !== 'reelkeep-ext') return;
    acceptExtPayload(d.payload).catch(() => {});
  });
  const m = /#reelkeep-save=(.+)$/.exec(location.hash);
  if (m) {
    try {
      acceptExtPayload(JSON.parse(decodeURIComponent(m[1]))).catch(() => {});
    } catch {
      /* malformed payload: ignore */
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
}
