/* ReelKeep video handler — every capability of the v1 gallery, unchanged:
   provider detection, embed overrides, direct files, frame-accurate covers,
   start times. `data` carries the v1 playback fields (see docs/data-format.md). */

import { PROVIDERS, detect, providerLabel, normalizeEmbedUrl, MEDIA_EXT } from '../providers.mjs';
import { legacyToItem } from '../schema.mjs';
import { hostOf } from '../util.mjs';

/** same-origin source usable by a <video> element and readable by canvas */
export function playableSrc(item, backend) {
  const d = item.data || {};
  const src = d.fileUrl || item.url;
  if (!src) return null;
  if (src.startsWith('/') || src.startsWith(location.origin)) return src;
  if (/^(data|blob):/.test(src)) return src;
  // Browser-only mode has no /media proxy: play the remote file directly.
  // Playback works, but cross-origin pixels stay unreadable for thumbnails.
  if (backend !== 'remote') return src;
  return `/media?url=${encodeURIComponent(src)}${item.url && d.fileUrl ? `&ref=${encodeURIComponent(item.url)}` : ''}`;
}

export const canPickFrames = (item, backend) => {
  if (item.data?.kind !== 'file') return false;
  const src = playableSrc(item, backend);
  if (!src) return false;
  if (backend === 'remote') return true;
  return src.startsWith('/') || src.startsWith(location.origin) || /^(data|blob):/.test(src);
};

/** the URL that goes inside the <iframe> */
export function frameSrc(item, backend, start = item.data?.startAt || 0) {
  const d = item.data || {};
  const manual = (d.playerUrl || '').trim();
  if (manual && d.kind !== 'file') {
    if (start && !/[?&#]start=/i.test(manual) && /youtube|vimeo|dailymotion|streamable/i.test(manual)) {
      return manual + (manual.includes('?') ? '&' : '?') + 'start=' + start;
    }
    return manual;
  }
  if (d.kind === 'file') {
    const p = new URLSearchParams({ src: playableSrc(item, backend) });
    if (start) p.set('t', start);
    return `/player.html?${p}`;
  }
  if (d.kind === 'embed' && PROVIDERS[d.provider]?.embed) return PROVIDERS[d.provider].embed({ videoId: d.videoId }, start);
  return item.url; // 'page' — may be blocked by the site
}

export const videoHandler = {
  type: 'video',
  icon: '#i-film',
  label: (item, t) => providerLabel({ provider: item.data?.provider, url: item.url }, t),
  sourceKey: (item) => item.data?.provider || 'page',
  detect(input) {
    if (input.file) return /^video\//.test(input.file.type) || MEDIA_EXT.test(input.file.name) ? 0.9 : 0;
    if (input.url) {
      const d = detect(input.url);
      return d.kind === 'invalid' ? 0 : d.kind === 'page' ? 0.3 : 0.95;
    }
    return 0;
  },
  async create(input) {
    return legacyToItem(input, {});
  },
  searchText() {
    return ''; // provider label is already indexed by the core
  },
  normalizeEmbedUrl,
  hostOf,
};
