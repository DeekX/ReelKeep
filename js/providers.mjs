/* ReelKeep video provider parsers — pure, node-testable.
   i18n is injected (defaults to the browser global `t` from i18n.js). */

import { hostOf, parseUrl } from './util.mjs';

const tr = (t) => t ?? globalThis.t ?? ((k) => k);

export const MEDIA_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|m3u8|mp3|m4a|wav)(\?|#|$)/i;

export const PROVIDERS = {
  youtube: {
    label: 'YouTube',
    test: (h) => /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(h),
    parse: (u) => {
      const id =
        u.searchParams.get('v') ||
        /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname)?.[1] ||
        (/youtu\.be$/i.test(u.hostname) ? u.pathname.slice(1).split('/')[0] : '');
      return /^[\w-]{11}$/.test(id || '') ? { videoId: id } : null;
    },
    embed: (v, s) => `https://www.youtube.com/embed/${v.videoId}?autoplay=1&rel=0&modestbranding=1${s ? `&start=${s}` : ''}`,
    thumb: (v) => `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    frames: (v, t) =>
      [
        [tr(t)('frames.default'), 'hqdefault'],
        ['25%', 'hq1'],
        ['50%', 'hq2'],
        ['75%', 'hq3'],
        [tr(t)('frames.maxres'), 'maxresdefault'],
      ].map(([label, code]) => ({ label, url: `https://i.ytimg.com/vi/${v.videoId}/${code}.jpg` })),
  },
  vimeo: {
    label: 'Vimeo',
    test: (h) => /(^|\.)(vimeo\.com|player\.vimeo\.com)$/.test(h),
    parse: (u) => {
      const id = /\/(?:video|channels\/[\w-]+)\/(\d+)/.exec(u.pathname)?.[1] || /^\/(\d{6,})/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v, s) => `https://player.vimeo.com/video/${v.videoId}?autoplay=1${s ? `&start=${s}` : ''}`,
    thumb: (v) => `https://vumbnail.com/${v.videoId}.jpg`,
  },
  dailymotion: {
    label: 'Dailymotion',
    test: (h) => /(^|\.)dailymotion\.com$/.test(h) || /(^|\.)dai\.ly$/.test(h),
    parse: (u) => {
      const id = /\/(?:video|embed\/video)\/([a-z0-9]+)/i.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v, s) => `https://www.dailymotion.com/embed/video/${v.videoId}?autoplay=1${s ? `&start=${s}` : ''}`,
    thumb: (v) => `https://www.dailymotion.com/thumbnail/video/${v.videoId}`,
  },
  twitch: {
    label: 'Twitch',
    test: (h) => /(^|\.)(twitch\.tv|clips\.twitch\.tv|player\.twitch\.tv)$/.test(h),
    parse: (u) => {
      const vid = /\/videos\/(\d+)/.exec(u.pathname)?.[1];
      if (vid) return { videoId: 'v' + vid };
      const clip = /clips\.twitch\.tv\/([\w-]+)/.exec(u.href) || /\/clip\/([\w-]+)/.exec(u.pathname);
      if (clip) return { videoId: clip[1] };
      const c = /\/clips\/([\w-]+)/.exec(u.pathname);
      if (c) return { videoId: c[1] };
      return null;
    },
    embed: (v) => {
      const parent = encodeURIComponent(location.hostname);
      // VOD ids carry a "v" prefix; clip ids are bare slugs. (v1 stored a `kind`
      // here that collided with the record kind and broke embedding — fixed.)
      return /^v\d+$/.test(v.videoId)
        ? `https://player.twitch.tv/?video=${v.videoId}&parent=${parent}&autoplay=true`
        : `https://clips.twitch.tv/embed?clip=${v.videoId}&parent=${parent}&autoplay=true`;
    },
  },
  tiktok: {
    label: 'TikTok',
    test: (h) => /(^|\.)(tiktok\.com|vm\.tiktok\.com)$/.test(h),
    parse: (u) => {
      const id = /\/video\/(\d+)/.exec(u.pathname)?.[1] || /\/photos\/(\d+)/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://www.tiktok.com/embed/v2/${v.videoId}`,
  },
  x: {
    label: 'X / Twitter',
    test: (h) => /(^|\.)(x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com)$/.test(h),
    parse: (u) => {
      const id = /\/status(?:es)?\/(\d+)/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://platform.twitter.com/embed/Tweet.html?id=${v.videoId}&theme=dark`,
  },
  facebook: {
    label: 'Facebook',
    test: (h) => /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/.test(h),
    parse: (u) => {
      if (/fb\.watch/i.test(u.hostname)) return { videoId: u.href };
      const id = /\/(?:videos|watch)\/(\d+)/.exec(u.pathname)?.[1] || u.searchParams.get('v');
      return id ? { videoId: u.href } : null;
    },
    embed: (v) => `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(v.videoId)}&show_text=false&autoplay=true`,
  },
  instagram: {
    label: 'Instagram',
    test: (h) => /(^|\.)instagram\.com$/.test(h),
    parse: (u) => {
      const id = /\/(?:p|reel|tv)\/([\w-]+)/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://www.instagram.com/p/${v.videoId}/embed/captioned/`,
  },
  loom: {
    label: 'Loom',
    test: (h) => /(^|\.)loom\.com$/.test(h),
    parse: (u) => {
      const id = /\/(?:embed|record|share)\/([\w-]+)/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://www.loom.com/embed/${v.videoId}?autoplay=true`,
  },
  wistia: {
    label: 'Wistia',
    test: (h) => /wistia/.test(h) || /(^|\.)wistia\.net$/.test(h),
    parse: (u) => {
      const id = /\/medias?\/([a-z0-9]+)/i.exec(u.pathname)?.[1] || /^\/([a-z0-9]{9,10})$/i.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://fast.wistia.net/embed/iframe/${v.videoId}?autoPlay=true`,
  },
  streamable: {
    label: 'Streamable',
    test: (h) => /(^|\.)streamable\.com$/.test(h),
    parse: (u) => {
      const id = /\/(?:e\/)?([a-z0-9]{4,12})$/i.exec(u.pathname)?.[1];
      return id && !/^(t|about|terms)$/i.test(id) ? { videoId: id } : null;
    },
    embed: (v, s) => `https://streamable.com/e/${v.videoId}?autoplay=1&controls=1${s ? `&start=${s}` : ''}`,
  },
  rutube: {
    label: 'Rutube',
    test: (h) => /(^|\.)rutube\.ru$/.test(h),
    parse: (u) => {
      const id = /\/(?:video\/embed\/|video\/)?([a-f0-9]{24,40})/i.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v, s) => `https://rutube.ru/play/embed/${v.videoId}${s ? `#t=${s}` : ''}`,
  },
  archive: {
    label: 'Internet Archive',
    test: (h) => /(^|\.)archive\.org$/.test(h),
    parse: (u) => {
      const id = /\/(?:details|embed)\/([^/?#]+)/.exec(u.pathname)?.[1];
      return id ? { videoId: id } : null;
    },
    embed: (v) => `https://archive.org/embed/${v.videoId}?autoplay=1`,
  },
};

export function detect(rawUrl) {
  const u = parseUrl(rawUrl);
  if (!u) return { provider: null, kind: 'invalid' };
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (p.test(u.hostname) && !MEDIA_EXT.test(u.pathname)) {
      const parsed = p.parse(u);
      if (parsed) return { provider: name, ...parsed, kind: 'embed' };
    }
  }
  if (MEDIA_EXT.test(u.pathname)) return { provider: 'file', kind: 'file' };
  return { provider: 'page', kind: 'page' };
}

export const providerLabel = (v, t) =>
  PROVIDERS[v.provider]?.label ||
  hostOf(v.url) ||
  (v.provider === 'file' ? tr(t)('prov.file') : v.provider === 'page' ? tr(t)('prov.page') : v.provider === 'custom' ? tr(t)('prov.custom') : v.provider) ||
  tr(t)('prov.video');

/** Pages often title themselves "- YouTube" or "Foo | SomeSite"; drop those suffixes
    so an auto-filled title is the video, not the site chrome. */
export function cleanTitle(raw, site) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  const known = /^(youtube|vimeo|dailymotion|twitch|tiktok|facebook|instagram|streamable|loom|wistia|rutube|internet archive|ted)/i;
  for (let i = 0; i < 2 && s; i++) {
    const m = /\s[-–—|·•]\s*([^|·•\s][^|·•]{0,47})$/.exec(s);
    if (!m) break;
    const tail = m[1].trim();
    if (!tail || tail.toLowerCase() === (site || '').toLowerCase() || known.test(tail)) s = s.slice(0, m.index).trim();
    else break;
  }
  s = s.replace(/^[-–—|·•:]\s*/, '').trim();
  if (s.length < 2) return null;
  if (site && s.toLowerCase() === site.toLowerCase()) return null;
  if (known.test(s) && s.length <= 20) return null; // bare "YouTube" / "Vimeo" chrome
  return s;
}

/** Embed dialogs often hand back a protocol-relative or plain-http player URL; this page
    may itself be served over http, and players that force https then refuse the frame. */
export function normalizeEmbedUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^\/\//.test(s)) return 'https:' + s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, 'https:');
  return s;
}
