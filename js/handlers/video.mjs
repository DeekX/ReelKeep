/* ReelKeep video handler — every capability of the v1 gallery, unchanged:
   provider detection, embed overrides, direct files, frame-accurate covers,
   start times. `data` carries the v1 playback fields (see docs/data-format.md). */

import { PROVIDERS, detect, providerLabel, normalizeEmbedUrl, MEDIA_EXT } from '../providers.mjs';
import { legacyToItem } from '../schema.mjs';
import { hostOf, fmtTime, parseTime, assetUrl, esc } from '../util.mjs';

const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|m3u8)(\?|#|$)/i;

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
  frame: true, // plays through the iframe stage (provider embeds / player.html)
  plays: true,
  badge: (item) => {
    const favHost = hostOf(item.url);
    const favSrc = (item.data?.favicon ? assetUrl(item.data.favicon) : null) || (favHost ? `https://${favHost}/favicon.ico` : '');
    return favSrc ? `<img src="${esc(favSrc)}" alt="" draggable="false" onerror="this.remove()">` : '<svg class="ticon"><use href="#i-film" /></svg>';
  },
  label: (item, t) => providerLabel({ provider: item.data?.provider, url: item.url }, t),
  sourceKey: (item) => item.data?.provider || 'page',
  stamp: (item) => {
    const d = item.data || {};
    return d.duration ? fmtTime(d.duration) : d.startAt ? '▶ ' + fmtTime(d.startAt) : '';
  },
  editExtra(container, item, ctx) {
    const d = item.data || {};
    container.innerHTML = `
      <label class="field short"><span><span>${ctx.esc(ctx.t('f.start'))}</span> <small>${ctx.esc(ctx.t('f.start.hint'))}</small></span><input id="edStart" type="text" placeholder="0:00" class="mono" value="${ctx.esc(d.startAt ? fmtTime(d.startAt) : '')}" /></label>
      <details class="adv">
        <summary>${ctx.esc(ctx.t('edit.adv'))}</summary>
        <label class="field"><span>${ctx.esc(ctx.t('edit.url'))}</span><input id="edUrl" type="url" spellcheck="false" value="${ctx.esc(item.url || '')}" /></label>
        <label class="field"><span><span>${ctx.esc(ctx.t('edit.embed'))}</span> <small>${ctx.esc(ctx.t('edit.embed.hint'))}</small></span><input id="edEmbed" type="text" spellcheck="false" placeholder="${ctx.esc(ctx.t('edit.ph.embed'))}" value="${ctx.esc(d.playerUrl || (d.kind === 'embed' ? PROVIDERS[d.provider]?.embed?.({ videoId: d.videoId }, 0) || '' : ''))}" /></label>
        <p class="help"><span>${ctx.esc(ctx.t('edit.detected'))}</span> <code id="edKind"></code></p>
      </details>`;
  },
  collectEdit(container, item) {
    const d = item.data || {};
    const embedOverride = normalizeEmbedUrl(container.querySelector('#edEmbed')?.value || '');
    const autoEmbed = d.kind === 'embed' && PROVIDERS[d.provider]?.embed ? PROVIDERS[d.provider].embed({ videoId: d.videoId }, 0) : '';
    return {
      startAt: parseTime(container.querySelector('#edStart')?.value) ?? 0,
      url: (container.querySelector('#edUrl')?.value || '').trim(),
      embedUrl: embedOverride && embedOverride !== autoEmbed ? embedOverride : '',
    };
  },
  detect(input) {
    if (input.file) return /^video\//.test(input.file.type) || VIDEO_EXT.test(input.file.name) ? 0.9 : 0;
    if (input.url) {
      const d = detect(input.url);
      if (d.kind === 'invalid') return 0;
      if (d.kind === 'file') return VIDEO_EXT.test(input.url) ? 0.95 : 0; // audio files belong to the audio handler
      return d.kind === 'page' ? 0.3 : 0.95;
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
