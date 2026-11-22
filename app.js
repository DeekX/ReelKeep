/* Video gallery — vanilla JS, works against server.js or falls back to localStorage. */
'use strict';

/* ============================================================ helpers */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function fmtTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "19:42" | "1:02:03" | "90" | "19m42s" -> seconds */
function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const hm = s.match(/^(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+(?:\.\d+)?)\s*s?)?$/);
  if (hm && (hm[1] || hm[2] || hm[3])) return (+hm[1] || 0) * 3600 + (+hm[2] || 0) * 60 + parseFloat(hm[3] || 0);
  const parts = s.split(':').filter((p) => p !== '');
  if (parts.length >= 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  }
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function parseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    try {
      return new URL('https://' + s.replace(/^\/+/, ''));
    } catch {
      return null;
    }
  }
}

const assetUrl = (t) => (!t ? null : /^(https?:|data:|blob:)/i.test(t) ? t : '/' + t.replace(/^\/+/, ''));
const relDate = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const days = (Date.now() - d) / 86400000;
  if (days < 1) return t('date.today');
  if (days < 2) return t('date.yesterday');
  if (days < 30) return t('date.days', { n: Math.floor(days) });
  return d.toLocaleDateString(i18nTag(), { day: 'numeric', month: 'short', year: days > 365 ? 'numeric' : undefined });
};

function debounce(fn, ms = 450) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.now = (...args) => {
    clearTimeout(t);
    return fn(...args);
  };
  return wrapped;
}

function toast(msg, kind = '', ms = 3400) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  el.onclick = () => el.remove();
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

function confirmBox(title, text) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#cfTitle').textContent = title;
    $('#cfText').textContent = text;
    let answer = false;
    $('#cfOk').onclick = () => {
      answer = true;
      dlg.close();
    };
    dlg.onclose = () => {
      dlg.onclose = null;
      resolve(answer);
    };
    dlg.showModal();
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

const seekPromise = (video, t) =>
  new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = Math.max(0, t);
    } catch {
      finish();
    }
    setTimeout(finish, 9000);
  });

function drawFrame(video, canvas, quality = 0.86) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = Math.min(1920, w);
  canvas.height = Math.round((canvas.width * h) / w);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/* =========================================================== providers */

const MEDIA_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|m3u8|mp3|m4a|wav)(\?|#|$)/i;

const PROVIDERS = {
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
    frames: (v) =>
      [
        [t('frames.default'), 'hqdefault'],
        ['25%', 'hq1'],
        ['50%', 'hq2'],
        ['75%', 'hq3'],
        [t('frames.maxres'), 'maxresdefault'],
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
      if (vid) return { videoId: 'v' + vid, kind: 'vods' };
      const clip = /clips\.twitch\.tv\/([\w-]+)/.exec(u.href) || /\/clip\/([\w-]+)/.exec(u.pathname);
      if (clip) return { videoId: clip[1], kind: 'clip' };
      const c = /\/clips\/([\w-]+)/.exec(u.pathname);
      if (c) return { videoId: c[1], kind: 'clip' };
      return null;
    },
    embed: (v) => {
      const parent = encodeURIComponent(location.hostname);
      return v.kind === 'clip'
        ? `https://clips.twitch.tv/embed?clip=${v.videoId}&parent=${parent}&autoplay=true`
        : `https://player.twitch.tv/?video=${v.videoId}&parent=${parent}&autoplay=true`;
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

function detect(rawUrl) {
  const u = parseUrl(rawUrl);
  if (!u) return { provider: null, kind: 'invalid' };
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (p.test(u.hostname) && !MEDIA_EXT.test(u.pathname)) {
      const parsed = p.parse(u);
      if (parsed) return { provider: name, kind: 'embed', ...parsed };
    }
  }
  if (MEDIA_EXT.test(u.pathname)) return { provider: 'file', kind: 'file' };
  return { provider: 'page', kind: 'page' };
}

const providerLabel = (v) =>
  PROVIDERS[v.provider]?.label ||
  hostOf(v.url) ||
  (v.provider === 'file' ? t('prov.file') : v.provider === 'page' ? t('prov.page') : v.provider === 'custom' ? t('prov.custom') : v.provider) ||
  t('prov.video');

/** Pages often title themselves "- YouTube" or "Foo | SomeSite"; drop those suffixes
    so an auto-filled title is the video, not the site chrome. */
function cleanTitle(raw, site) {
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
function normalizeEmbedUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^\/\//.test(s)) return 'https:' + s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, 'https:');
  return s;
}

/** the URL that goes inside the <iframe> */
function frameSrc(v, start = v.startAt || 0) {
  const manual = (v.embedUrl || '').trim();
  if (manual && v.kind !== 'file') {
    if (start && !/[?&#]start=/i.test(manual) && /youtube|vimeo|dailymotion|streamable/i.test(manual)) {
      return manual + (manual.includes('?') ? '&' : '?') + 'start=' + start;
    }
    return manual;
  }
  if (v.kind === 'file') {
    const p = new URLSearchParams({ src: playableSrc(v) });
    if (start) p.set('t', start);
    return `/player.html?${p}`;
  }
  if (v.kind === 'embed' && PROVIDERS[v.provider]?.embed) return PROVIDERS[v.provider].embed(v, start);
  return v.url; // 'page' — may be blocked by the site
}

/** same-origin source usable by a <video> element and readable by canvas */
function playableSrc(v) {
  const src = v.fileUrl || v.url;
  if (!src) return null;
  if (src.startsWith('/') || src.startsWith(location.origin)) return src;
  if (/^(data|blob):/.test(src)) return src;
  // Browser-only mode has no /media proxy: play the remote file directly.
  // Playback works, but cross-origin pixels stay unreadable for thumbnails.
  if (state.backend !== 'remote') return src;
  return `/media?url=${encodeURIComponent(src)}${v.url && v.fileUrl ? `&ref=${encodeURIComponent(v.url)}` : ''}`;
}

const canPickFrames = (v) => {
  if (v.kind !== 'file') return false;
  const src = playableSrc(v);
  if (!src) return false;
  if (state.backend === 'remote') return true;
  return src.startsWith('/') || src.startsWith(location.origin) || /^(data|blob):/.test(src);
};

/* ============================================================== state */

const state = {
  videos: [],
  folders: [],
  folder: 'all', // 'all' | 'unfiled' | folder id
  q: '',
  tokens: [],
  sort: 'added',
  provider: '',
  tags: new Set(),
  view: 'grid',
  group: false, // cluster cards into per-source sections
  selecting: false,
  selected: new Set(),
  limit: 60, // rendered cards; "Load more" raises it
  backend: 'remote', // or 'local'
  current: null, // video open in lightbox
  lastTime: 0,
};

const VIEW_KEY = 'video-gallery.view';

function applyView(mode) {
  state.view = mode === 'list' ? 'list' : 'grid';
  $('#grid').classList.toggle('list', state.view === 'list');
  $('#viewGrid').classList.toggle('on', state.view === 'grid');
  $('#viewList').classList.toggle('on', state.view === 'list');
  $('#viewGrid').setAttribute('aria-pressed', String(state.view === 'grid'));
  $('#viewList').setAttribute('aria-pressed', String(state.view === 'list'));
  try {
    localStorage.setItem(VIEW_KEY, state.view);
  } catch {
    /* private mode or file:// — the choice just won't be remembered */
  }
}

$('#viewGrid').addEventListener('click', () => applyView('grid'));
$('#viewList').addEventListener('click', () => applyView('list'));

const GROUP_KEY = 'video-gallery.group';

function applyGroup(on) {
  state.group = !!on;
  $('#groupBtn').classList.toggle('on', state.group);
  $('#groupBtn').setAttribute('aria-pressed', String(state.group));
  try {
    localStorage.setItem(GROUP_KEY, state.group ? '1' : '0');
  } catch {
    /* private mode or file:// */
  }
  render();
}

$('#groupBtn').addEventListener('click', () => applyGroup(!state.group));

$('#langSel').addEventListener('change', (e) => setLocale(e.target.value));
document.addEventListener('reelkeep:locale', () => {
  $('#langSel').value = i18nCurrent();
  render();
  setBackend(state.backend);
  if (editDialog.open && editing) openEdit(editing.id);
  if (lb.open && state.current) {
    paintLbMeta(state.current);
    paintLbDetails(state.current);
  }
  if (moveDialog.open) paintMoveList();
  if (!$('#pvStatus').hidden) $('#pvStatusText').textContent = t('add.preview.ok');
});

const LS_KEY = 'video-gallery.v1';
const localLib = {
  read: () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || { videos: [] };
    } catch {
      return { videos: [] };
    }
  },
  write: (db) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(db));
    } catch {
      toast(t('to.storagefull'), 'err', 6000);
    }
  },
};

const store = {
  async load() {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      return { videos: db.videos || [], folders: db.folders || [] };
    }
    const res = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(await res.text());
    const db = await res.json();
    return { videos: db.videos || [], folders: db.folders || [] };
  },
  async createFolder(name) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      const folder = { id: 'f_' + Math.random().toString(36).slice(2, 14), name, createdAt: new Date().toISOString() };
      db.folders = [...(db.folders || []), folder];
      localLib.write(db);
      return folder;
    }
    const res = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).folder;
  },
  async renameFolder(id, name) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      const f = (db.folders || []).find((x) => x.id === id);
      if (!f) throw new Error('not found');
      f.name = name;
      localLib.write(db);
      return f;
    }
    const res = await fetch(`/api/folders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).folder;
  },
  async removeFolder(id) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      db.folders = (db.folders || []).filter((f) => f.id !== id);
      db.videos = (db.videos || []).filter((v) => v.folderId !== id);
      localLib.write(db);
      return;
    }
    const res = await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
  async move(ids, folderId) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      (db.videos || []).forEach((v) => {
        if (ids.includes(v.id)) v.folderId = folderId;
      });
      localLib.write(db);
      return ids.length;
    }
    const res = await fetch('/api/videos/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, folderId }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).moved;
  },
  async create(rec) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      db.videos = db.videos || [];
      db.videos.unshift(rec);
      localLib.write(db);
      return rec;
    }
    const res = await fetch('/api/videos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rec),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).video;
  },
  async update(id, patch) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      const v = db.videos.find((x) => x.id === id);
      if (!v) throw new Error('not found');
      Object.assign(v, patch);
      localLib.write(db);
      return v;
    }
    const res = await fetch(`/api/videos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).video;
  },
  async remove(id) {
    if (state.backend !== 'remote') {
      const db = localLib.read();
      db.videos = (db.videos || []).filter((v) => v.id !== id);
      localLib.write(db);
      return;
    }
    const res = await fetch(`/api/videos/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(res.statusText);
  },
  /** persist an image; returns a storable thumbnail reference */
  async saveImage(dataUrl) {
    if (state.backend !== 'remote') return dataUrl;
    const res = await fetch('/api/thumbnails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    return (await res.json()).thumbnail;
  },
  /** copy a hotlinked image (og:image) into ./thumbnails so it never breaks */
  async saveImageFromUrl(url, referer) {
    if (state.backend !== 'remote' || !/^https?:/i.test(url)) return url;
    const res = await fetch('/api/thumbnails/from-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, referer }),
    });
    if (!res.ok) {
      const why = await res.json().catch(() => ({}));
      toast(t('to.copyfail', { err: why.error || res.status }), 'err', 5000);
      return url;
    }
    return (await res.json()).thumbnail;
  },
  upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      if (state.backend !== 'remote') return reject(new Error(t('err.uploadlocal')));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/videos/upload');
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          xhr.status < 300 ? resolve(body) : reject(new Error(body.error || xhr.statusText));
        } catch {
          reject(new Error(t('to.uploadfail')));
        }
      };
      xhr.onerror = () => reject(new Error(t('to.uploadlost')));
      xhr.send(file);
    });
  },
};

const byId = (id) => state.videos.find((v) => v.id === id);

async function patch(id, data, rerender = true) {
  try {
    const v = await store.update(id, data);
    Object.assign(byId(id) || {}, v);
    if (rerender) render();
    return v;
  } catch (err) {
    toast(t('to.savefail', { err: err.message }), 'err');
  }
}

const thumbnailFor = (v) => assetUrl(v.thumbnail) || PROVIDERS[v.provider]?.thumb?.(v) || null;

/* ============================================================== render */

function matches(v, tokens) {
  if (!tokens.length) return true;
  const hay = [v.title, v.notes, v.url, providerLabel(v), ...(v.tags || [])].join(' ').toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

function highlight(text, tokens) {
  const safe = esc(text || '');
  if (!tokens.length) return safe;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

function visibleVideos() {
  const tokens = state.tokens;
  let list = state.videos.filter((v) => {
    if (state.folder === 'unfiled' && v.folderId) return false;
    if (state.folder !== 'all' && state.folder !== 'unfiled' && v.folderId !== state.folder) return false;
    if (state.provider && v.provider !== state.provider) return false;
    if (state.tags.size && ![...state.tags].every((t) => (v.tags || []).includes(t))) return false;
    return matches(v, tokens);
  });
  const cmp = {
    added: (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0),
    oldest: (a, b) => new Date(a.addedAt || 0) - new Date(b.addedAt || 0),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    opened: (a, b) => new Date(b.lastOpenedAt || 0) - new Date(a.lastOpenedAt || 0),
    duration: (a, b) => (b.duration || 0) - (a.duration || 0),
  }[state.sort];
  return list.sort(cmp);
}

function cardHtml(v, tokens) {
  const thumb = thumbnailFor(v);
  const label = esc(providerLabel(v));
  const favHost = hostOf(v.url);
  const favSrc = assetUrl(v.favicon) || (favHost ? `https://${favHost}/favicon.ico` : '');
  const fav = favSrc ? `<img src="${esc(favSrc)}" alt="" draggable="false" onerror="this.remove()">` : '';
  const stamp = v.duration ? fmtTime(v.duration) : v.startAt ? '▶ ' + fmtTime(v.startAt) : '';
  const tags = (v.tags || []).slice(0, 3).map((t) => `<span class="t">#${esc(t)}</span>`).join('');
  const folder = state.folders.find((f) => f.id === v.folderId);
  const fold = folder && state.folder === 'all' ? `<span class="fold"><svg><use href="#i-folder" /></svg>${esc(folder.name)}</span>` : '';
  const sel = state.selecting
    ? `<label class="card-select"><input type="checkbox" data-act="select" ${state.selected.has(v.id) ? 'checked' : ''} aria-label="${esc(t('card.select', { title: v.title }))}" /></label>`
    : '';
  return `<article class="card${state.selected.has(v.id) ? ' selected' : ''}" data-id="${v.id}" tabindex="0" draggable="true" aria-label="${esc(v.title)}">
    <div class="thumb">
      ${sel}
      <div class="ph"><svg><use href="#i-film" /></svg></div>
      ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="badge">${fav}${label}</span>
      ${stamp ? `<span class="stamp">${esc(stamp)}</span>` : ''}
      <div class="thumb-play"><span><svg><use href="#i-play" /></svg></span></div>
      <div class="card-actions">
        <button class="icon-btn" data-act="edit" title="Edit / rename"><svg><use href="#i-edit" /></svg></button>
        <button class="icon-btn" data-act="del" title="Delete"><svg><use href="#i-trash" /></svg></button>
      </div>
    </div>
    <div class="card-body">
      <h3 class="card-title" data-act="rename" title="${esc(t('lb.rename'))}">${highlight(v.title || t('card.untitled'), tokens)}</h3>
      ${v.notes ? `<p class="card-notes">${esc(v.notes)}</p>` : ''}
      <div class="card-sub">${fold}${tags}<span class="host">${esc(hostOf(v.url) || t('card.local'))}</span>${v.startAt ? `<span>· ${esc(t('card.starts', { t: fmtTime(v.startAt) }))}</span>` : ''}<span class="when">${esc(relDate(v.addedAt))}</span></div>
    </div>
  </article>`;
}

function renderTagbar() {
  const counts = new Map();
  state.videos.forEach((v) => (v.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const bar = $('#tagbar');
  bar.innerHTML =
    `<span class="tagbar-label">${esc(t('tags.label'))}</span>` +
    `<button class="chip${state.tags.size ? '' : ' on'}" data-tagreset="1">${esc(t('tags.all'))}</button>` +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, n]) => `<button class="chip${state.tags.has(tag) ? ' on' : ''}" data-tag="${esc(tag)}">#${esc(tag)}<small>${n}</small></button>`)
      .join('');
}

function renderProviders() {
  const sel = $('#providerSel');
  const keep = state.provider;
  const seen = new Map();
  state.videos.forEach((v) => seen.set(v.provider, providerLabel(v)));
  sel.innerHTML =
    `<option value="">${esc(t('source.all'))}</option>` +
    [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([k, label]) => `<option value="${esc(k)}"${k === keep ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
}

const groupKey = (v) => (v.provider === 'page' || v.provider === 'custom' ? hostOf(v.url) || v.provider : v.provider);

function render() {
  const tokens = state.tokens;
  const list = visibleVideos();
  // chunked rendering: large libraries stay responsive, "Load more" appends
  const shown = list.slice(0, state.limit);
  let html;
  if (state.group) {
    const groups = new Map();
    list.forEach((v) => {
      const k = groupKey(v);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    });
    let budget = state.limit;
    html = [...groups.values()]
      .sort((a, b) => providerLabel(a[0]).localeCompare(providerLabel(b[0])))
      .map((vs) => {
        const take = Math.min(vs.length, budget);
        budget -= take;
        if (take <= 0) return '';
        return (
          `<div class="group-head"><svg><use href="#i-group" /></svg><h2>${esc(providerLabel(vs[0]))}</h2><span>${vs.length}</span></div>` +
          vs.slice(0, take).map((v) => cardHtml(v, tokens)).join('')
        );
      })
      .join('');
  } else {
    html = shown.map((v) => cardHtml(v, tokens)).join('');
  }
  $('#grid').innerHTML = html;
  const row = $('#pageRow');
  row.hidden = list.length <= state.limit;
  if (!row.hidden) $('#pageShowing').textContent = t('page.showing', { a: shown.length, b: list.length });
  $('#headCount').textContent = t(state.videos.length === 1 ? 'count.one' : 'count.other', { n: state.videos.length });
  $('#grid').classList.toggle('selecting', state.selecting);
  // an empty flex:1 grid would eat the free space and push #empty to the footer
  $('#grid').hidden = list.length === 0;
  $('#count').textContent =
    t(state.videos.length === 1 ? 'count.one' : 'count.other', { n: state.videos.length }) +
    (tokens.length || state.tags.size || state.provider || state.folder !== 'all' ? ' ' + t('count.shown', { n: list.length }) : '');
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!state.videos.length) {
    $('#emptyTitle').textContent = t('empty.title');
    $('#emptyText').textContent = t('empty.text');
  } else {
    $('#emptyTitle').textContent = t('nomatch.title');
    $('#emptyText').textContent = t('nomatch.text');
  }
  renderTagbar();
  renderProviders();
  renderFolderbar();
  renderFolderActions();
  renderSelectbar();
}

function renderFolderbar() {
  const counts = new Map();
  let unfiled = 0;
  state.videos.forEach((v) => {
    if (v.folderId) counts.set(v.folderId, (counts.get(v.folderId) || 0) + 1);
    else unfiled++;
  });
  const chip = (key, label, n, extra = '') =>
    `<button class="chip${state.folder === key ? ' on' : ''}" data-folder="${esc(key)}" ${extra}>${label}<small>${n}</small></button>`;
  $('#folderbar').innerHTML =
    chip('all', t('folder.all'), state.videos.length) +
    chip('unfiled', t('folder.unfiled'), unfiled) +
    state.folders
      .map((f) => chip(f.id, `<svg class="fi"><use href="#i-folder" /></svg>${esc(f.name)}`, counts.get(f.id) || 0, `title="${esc(t('folder.chip.title'))}"`))
      .join('') +
    `<button class="chip newfolder" data-newfolder="1" title="${esc(t('folder.new.title'))}"><svg class="fi"><use href="#i-plus" /></svg>${esc(t('folder.new'))}</button>`;
}

function renderSelectbar() {
  const bar = $('#selectbar');
  bar.hidden = !state.selecting;
  $('#selCount').textContent = t('sel.count', { n: state.selected.size });
  $('#selMove').disabled = !state.selected.size;
  $('#selectBtn').classList.toggle('on', state.selecting);
  $('#selectBtn').setAttribute('aria-pressed', String(state.selecting));
}

function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  render();
}

function setSelecting(on) {
  state.selecting = on;
  if (!on) state.selected.clear();
  render();
}

/* ============================================================ lightbox */

const lb = $('#lightbox');

function openPlayer(id) {
  const v = byId(id);
  if (!v) return;
  state.current = v;
  state.lastTime = 0;
  $('#lbFrame').src = frameSrc(v);
  $('#lbTitle').textContent = v.title || t('card.untitled');
  paintLbMeta(v);
  paintLbDetails(v);
  $('#lbRemember').checked = false;
  $('#lbRemember').closest('.switch').hidden = v.kind !== 'file';
  $$('.lb-nav').forEach((b) => (b.style.visibility = ''));
  positionNav();
  lb.showModal();
  patch(v.id, { lastOpenedAt: new Date().toISOString() }, false);
}

function paintLbMeta(v) {
  $('#lbHint').hidden = v.kind !== 'page';
  if (v.kind === 'page') $('#lbHint').textContent = t('lb.hint');
  const bits = [];
  if (v.url) bits.push(`<span class="m">${esc(hostOf(v.url))}</span>`);
  if (v.duration) bits.push(`<span class="m">${fmtTime(v.duration)}</span>`);
  if (v.startAt) bits.push(`<span class="m">${esc(t('lb.starts', { t: fmtTime(v.startAt) }))}</span>`);
  bits.push(...(v.tags || []).map((tag) => `<span class="t">#${esc(tag)}</span>`));
  $('#lbMeta').innerHTML = bits.join('');
}

function paintLbDetails(v) {
  const folder = state.folders.find((f) => f.id === v.folderId);
  $('#lbSub').textContent = `${providerLabel(v)} / ${folder ? folder.name : t('folder.unfiled')}`;
  const list = visibleVideos();
  const i = list.findIndex((x) => x.id === v.id);
  $('#lbPos').textContent = i === -1 ? '' : t('lb.position', { i: i + 1, n: list.length });
  const notes = $('#lbNotes');
  notes.hidden = !v.notes;
  if (v.notes) notes.innerHTML = `<b>${esc(v.notes)}</b>`;
}

function positionNav() {
  const list = visibleVideos();
  const i = list.findIndex((v) => v.id === state.current?.id);
  if (i === -1) return;
  $('.lb-nav.prev').style.visibility = i > 0 ? '' : 'hidden';
  $('.lb-nav.next').style.visibility = i < list.length - 1 ? '' : 'hidden';
}

function stepVideo(dir) {
  const list = visibleVideos();
  const i = list.findIndex((v) => v.id === state.current?.id);
  const next = list[i + dir];
  if (next) openPlayer(next.id);
}

function closePlayer() {
  const remember = $('#lbRemember').checked && state.lastTime > 1 && state.current?.kind === 'file';
  if (remember && state.current) patch(state.current.id, { startAt: Math.floor(state.lastTime) }, false);
  lb.close();
  $('#lbFrame').src = 'about:blank';
  lb.classList.remove('fit');
  state.current = null;
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.from !== 'vg-player') return;
  if (d.type === 'time') state.lastTime = d.t;
  if (d.type === 'meta' && d.duration && state.current && !state.current.duration) {
    patch(state.current.id, { duration: Math.round(d.duration) }, false);
  }
});

lb.addEventListener('click', (e) => {
  if (e.target === lb) closePlayer(); // click on the backdrop area
});

$('#lightbox').addEventListener('cancel', (e) => {
  e.preventDefault();
  closePlayer();
});

$$('[data-lb]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const act = btn.dataset.lb;
    if (act === 'close') closePlayer();
    if (act === 'prev') stepVideo(-1);
    if (act === 'next') stepVideo(1);
    if (act === 'open' && state.current?.url) window.open(state.current.url, '_blank', 'noopener');
    if (act === 'edit' && state.current) openEdit(state.current.id);
    if (act === 'thumb' && state.current) openThumbPicker(state.current.id);
    if (act === 'fit') {
      lb.classList.toggle('fit');
      btn.classList.toggle('on');
    }
    if (act === 'full') {
      const stage = $('#lbStage');
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen?.().catch(() => toast(t('to.fullscreen'), 'err'));
      btn.classList.toggle('on', !!document.fullscreenElement);
    }
  }),
);

lb.addEventListener('dblclick', (e) => {
  const h2 = e.target.closest('#lbTitle');
  const v = state.current;
  if (!h2 || !v) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = v.title || '';
  h2.replaceWith(input);
  input.focus();
  input.select();
  const restore = () => {
    const back = Object.assign(document.createElement('h2'), {
      id: 'lbTitle',
      className: 'lb-title',
      textContent: state.current?.title || t('card.untitled'),
      title: t('lb.rename'),
    });
    if (input.isConnected) input.replaceWith(back);
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === 'Escape') {
      input.value = state.current?.title || '';
      input.blur();
    }
  };
  input.onblur = async () => {
    const next = input.value.trim();
    if (next && next !== v.title) await patch(v.id, { title: next }, false);
    restore();
    render();
  };
});

/* ============================================================== add */

const addDialog = $('#addDialog');
let draft = null;
let pickedFile = null;

function newDraft() {
  draft = {
    title: '',
    url: '',
    tags: [],
    notes: '',
    startAt: 0,
    kind: 'page',
    provider: 'page',
    videoId: null,
    embedUrl: '',
    fileUrl: '',
    thumbnail: '',
    image: '',
    favicon: '',
    site: '',
    duration: null,
  };
  pickedFile = null;
  $('#addUrl').value = '';
  $('#addEmbed').value = '';
  $('#addFile').value = '';
  $('#pvTitle').value = '';
  $('#pvTags').value = '';
  $('#pvStart').value = '';
  $('#pvNotes').value = '';
  $('#pvUseOg').checked = true;
  $('#pvFolder').innerHTML =
    `<option value="">${esc(t('folder.unfiled'))}</option>` +
    state.folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  $('#pvDetTitle').textContent = '';
  $('#pvDetSub').textContent = '';
  $('#pvStatus').hidden = true;
  $('#dropLabel').textContent = t('upload.choose');
  $('#upProgress').hidden = true;
  $('#addPreview').hidden = true;
  setStatus('');
  updateSave();
}

function setStatus(msg, kind = '') {
  const el = $('#addStatus');
  el.textContent = msg;
  el.className = 'statusline ' + kind;
}

function updateSave() {
  const tab = $('#addDialog .tab.active').dataset.tab;
  const ok = tab === 'link' ? !!draft.url : tab === 'embed' ? !!draft.embedUrl : !!pickedFile;
  $('#addSave').disabled = !ok;
}

function paintPreview() {
  const holder = $('#pvThumb');
  const img = draft.image && $('#pvUseOg').checked ? assetUrl(draft.image) : draft.thumbnail ? assetUrl(draft.thumbnail) : PROVIDERS[draft.provider]?.thumb?.(draft);
  holder.innerHTML = img
    ? `<img src="${esc(assetUrl(img))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ptime">auto</span>`
    : `<span class="placeholder">no thumbnail</span>`;
  $('#addPreview').hidden = !(draft.url || draft.embedUrl || pickedFile);
  if (!$('#pvDetTitle').textContent) {
    $('#pvDetTitle').textContent = draft.title || hostOf(draft.url) || pickedFile?.name || '';
    $('#pvDetSub').textContent = draft.url || draft.embedUrl ? providerLabel(draft) : '';
  }
}

function setDetected(title, sub, ok) {
  $('#pvDetTitle').textContent = title || '';
  $('#pvDetSub').textContent = sub || '';
  const st = $('#pvStatus');
  st.hidden = ok !== true;
  if (ok === true) $('#pvStatusText').textContent = t('add.preview.ok');
}

const enrich = debounce(async (raw) => {
  const u = parseUrl(raw);
  if (!u) return;
  const found = detect(u.href);
  Object.assign(draft, { url: u.href, provider: found.provider, kind: found.kind, videoId: found.videoId || null });
  paintPreview();
  if (found.kind === 'invalid') return setStatus(t('st.invalid'), 'err');
  if (state.backend !== 'remote') return setStatus(t('st.localenrich'), 'err');
  setStatus(t('st.reading', { host: hostOf(u.href) }), 'busy');
  try {
    const meta = await (await fetch('/api/enrich?url=' + encodeURIComponent(u.href))).json();
    if (draft.url !== u.href) return; // superseded by a newer paste
    if (meta.error) throw new Error(meta.error);
    draft.site = meta.siteName || hostOf(meta.pageUrl || u.href);
    draft.favicon = meta.favicon || '';
    if (meta.image) draft.image = meta.image;
    const clean = cleanTitle(meta.title, meta.siteName || hostOf(meta.pageUrl || u.href));
    if (clean && !$('#pvTitle').value.trim()) {
      draft.title = clean;
      $('#pvTitle').value = clean;
    }
    if (meta.duration) draft.duration = meta.duration;
    setDetected(
      clean || draft.title || hostOf(u.href),
      `${providerLabel(draft)}${draft.site ? ' · ' + draft.site : ''}${draft.duration ? ' · ' + fmtTime(draft.duration) : ''}`,
      true,
    );
    if (found.kind === 'page' && meta.mediaUrl) {
      draft.kind = 'file';
      draft.provider = 'file';
      draft.fileUrl = meta.mediaUrl;
      setStatus(t('st.direct'), 'ok');
    } else if (found.kind === 'page') {
      setStatus(t('st.page'), '');
    } else {
      setStatus(t('st.detected', { provider: providerLabel(draft) }), 'ok');
    }
    paintPreview();
  } catch (err) {
    setDetected($('#pvDetTitle').textContent, $('#pvDetSub').textContent, 'err');
    setStatus(t('st.enrichfail', { err: err.message }), 'err');
  }
}, 550);

$('#addUrl').addEventListener('input', (e) => {
  draft.url = e.target.value.trim();
  $('#addPreview').hidden = !draft.url;
  enrich(draft.url);
  updateSave();
});
$('#addUrl').addEventListener('paste', () => setTimeout(() => enrich($('#addUrl').value), 60));
$('#addUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    enrich.now($('#addUrl').value.trim());
  }
});
$('#pvTitle').addEventListener('input', (e) => (draft.title = e.target.value));
$('#pvUseOg').addEventListener('change', paintPreview);

$('#addEmbed').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  const found = /<iframe[^>]*src\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] || (/^<iframe/i.test(raw) ? null : raw);
  const src = normalizeEmbedUrl(found);
  draft.embedUrl = src;
  draft.kind = src ? 'embed' : 'page';
  draft.provider = PROVIDERS.youtube.test(hostOf(src || '')) ? 'youtube' : 'custom';
  if (src) {
    draft.url = draft.url || src;
    setStatus(t('st.embedok', { url: src }), 'ok');
  } else setStatus(t('st.embedhelp'), '');
  paintPreview();
  updateSave();
});

const dropField = $('#dropField');
$('#addFile').addEventListener('change', (e) => {
  pickedFile = e.target.files?.[0] || null;
  if (pickedFile) {
    $('#dropLabel').textContent = `${pickedFile.name} · ${(pickedFile.size / 1048576).toFixed(1)} MB`;
    if (!$('#pvTitle').value) $('#pvTitle').value = pickedFile.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    draft.title = $('#pvTitle').value;
    draft.url = '';
    draft.kind = 'file';
    draft.provider = 'file';
    setStatus(t('st.uploadok'), 'ok');
  }
  paintPreview();
  updateSave();
});
dropField.addEventListener('click', () => $('#addFile').click());

$$('#addDialog .tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('#addDialog .tab').forEach((x) => x.classList.toggle('active', x === tab));
    $$('.panel[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === 'upload' && state.backend !== 'remote') {
      setStatus(t('st.uploadlocal'), 'err');
    }
    updateSave();
  }),
);

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#addSave');
  btn.disabled = true;
  const tab = $('#addDialog .tab.active').dataset.tab;
  try {
    let fileUrl = '';
    if (tab === 'upload') {
      $('#upProgress').hidden = false;
      const up = await store.upload(pickedFile, (pct) => ($('#upProgress').value = pct));
      fileUrl = up.fileUrl;
    }
    const wantOg = $('#pvUseOg').checked && draft.image;
    const rawThumb = wantOg ? draft.image : draft.thumbnail;
    const thumb = rawThumb && /^https?:/i.test(rawThumb) ? await store.saveImageFromUrl(rawThumb, draft.url || undefined) : rawThumb || '';
    const rec = {
      title: ($('#pvTitle').value || draft.title || pickedFile?.name || hostOf(draft.url) || 'Untitled').trim(),
      url: draft.url || fileUrl,
      kind: tab === 'upload' ? 'file' : draft.kind,
      provider: tab === 'upload' ? 'file' : draft.provider,
      videoId: draft.videoId,
      embedUrl: draft.embedUrl || '',
      fileUrl: fileUrl || draft.fileUrl || '',
      tags: ($('#pvTags').value || '')
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 12),
      notes: $('#pvNotes').value.trim(),
      startAt: parseTime($('#pvStart').value) ?? 0,
      thumbnail: thumb,
      thumbSource: wantOg ? 'page-image' : draft.thumbnail ? 'provider' : 'auto',
      thumbTime: null,
      favicon: draft.favicon,
      site: draft.site,
      duration: draft.duration,
      folderId: $('#pvFolder').value || '',
      addedAt: new Date().toISOString(),
    };
    const saved = await store.create(rec);
    state.videos.unshift(saved);
    render();
    addDialog.close();
    toast(t('to.added', { title: saved.title }), 'ok');
    if (saved.kind === 'file') autoThumbnail(saved);
    $('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    updateSave();
  }
});

$('#addBtn').addEventListener('click', openAdd);
$$('[data-open="add"]').forEach((b) => b.addEventListener('click', openAdd));

function openAdd(tabName) {
  newDraft();
  if (tabName) $(`.tab[data-tab="${tabName}"]`)?.click();
  addDialog.showModal();
  setTimeout(() => $('#addUrl').focus(), 40);
}

/* ============================================================ edit */

const editDialog = $('#editDialog');
let editing = null;

function paintEditThumb() {
  if (!editing) return;
  const thumb = thumbnailFor(editing);
  $('#edThumb').innerHTML = thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : '<span class="placeholder">no thumbnail</span>';
}

function openEdit(id) {
  const v = byId(id);
  if (!v) return;
  editing = v;
  thumbTarget = v;
  paintEditThumb();
  $('#edTitle').value = v.title || '';
  $('#edTags').value = (v.tags || []).join(', ');
  $('#edStart').value = v.startAt ? fmtTime(v.startAt) : '';
  $('#edNotes').value = v.notes || '';
  $('#edUrl').value = v.url || '';
  $('#edEmbed').value = v.embedUrl || (v.kind === 'embed' ? PROVIDERS[v.provider]?.embed?.(v, 0) || '' : '');
  $('#edKind').textContent = `${v.kind}${v.provider ? ' · ' + providerLabel(v) : ''} · ${t(canPickFrames(v) ? 'edit.frames.ok' : 'edit.frames.no')}`;
  $('#edFrame').disabled = !canPickFrames(v);
  $('#edFrame').title = t(canPickFrames(v) ? 'edit.frame.ok' : 'edit.frame.no');
  if (!editDialog.open) editDialog.showModal();
}

$('#edFrame').addEventListener('click', () => openThumbPicker(editing.id));

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const embedOverride = normalizeEmbedUrl($('#edEmbed').value);
  const autoEmbed = editing.kind === 'embed' && PROVIDERS[editing.provider]?.embed ? PROVIDERS[editing.provider].embed({ ...editing, url: $('#edUrl').value.trim() }, 0) : '';
  await patch(editing.id, {
    title: $('#edTitle').value.trim() || editing.title || 'Untitled',
    tags: ($('#edTags').value || '')
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 12),
    notes: $('#edNotes').value.trim(),
    startAt: parseTime($('#edStart').value) ?? 0,
    url: $('#edUrl').value.trim(),
    embedUrl: embedOverride && embedOverride !== autoEmbed ? embedOverride : '',
  });
  editDialog.close();
  toast(t('to.saved'), 'ok', 1800);
});

$('#edDelete').addEventListener('click', async () => {
  if (!(await confirmBox(t('cf.title'), t('cf.edit')))) return;
  const id = editing.id;
  await store.remove(id);
  state.videos = state.videos.filter((v) => v.id !== id);
  state.selected.delete(id);
  render();
  editDialog.close();
  if (lb.open) closePlayer();
  toast(t('to.deleted'), '', 1800);
});

$('#edDefault').addEventListener('click', async () => {
  await patch(editing.id, { thumbnail: '', thumbSource: 'auto', thumbTime: null });
  openEdit(editing.id);
});

$('#edImage').addEventListener('click', () => $('#tpUpload').click());
$('#edImageUrl').addEventListener('click', () => {
  const url = window.prompt(t('prompt.imageurl'), 'https://');
  if (url && url !== 'https://') setThumbnail(editing.id, url.trim(), 'url');
});

/* ======================================================= thumbnail picker */

const thumbDialog = $('#thumbDialog');
let thumbTarget = null; // video whose cover is being edited
let thumbVideoReady = false;

async function setThumbnail(id, value, source, time = null) {
  if (!value) return;
  await patch(id, { thumbnail: value, thumbSource: source, thumbTime: time });
  if (editing?.id === id) paintEditThumb();
  toast(source === 'frame' ? t('to.coverframe', { t: fmtTime(time) }) : t('to.cover'), 'ok', 2000);
}

async function openThumbPicker(id) {
  const v = byId(id);
  if (!v) return;
  thumbTarget = v;
  thumbVideoReady = false;
  const playable = canPickFrames(v);
  const frames = PROVIDERS[v.provider]?.frames?.(v);
  $('#tpFileTitle').textContent = v.title || t('card.untitled');
  $('#tpFileName').textContent = v.fileUrl ? v.fileUrl.split('/').pop() : hostOf(v.url);
  $('#tpProvider').hidden = !frames;
  $('#tpBlocked').hidden = playable || !!frames;
  $('#tpTabFrame').disabled = !playable;
  setPickerTab(playable ? 'frame' : 'image');
  if (frames) {
    $('#tpFrames').innerHTML = frames
      .map((f, i) => `<button type="button" class="frame-opt" data-frame="${i}"><img src="${esc(f.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="if(this.naturalWidth<200)this.closest('.frame-opt').remove()" onerror="this.closest('.frame-opt').remove()"><span>${esc(f.label)}</span></button>`)
      .join('');
  }
  $('#tpUrl').value = '';
  $('#tpAlsoStart').checked = false;
  $('#tpTime').value = v.startAt ? fmtTime(v.startAt) : '';
  $('#tpOut').textContent = '0:00.000';
  $('#tpMin').textContent = '0:00';
  $('#tpMax').textContent = '0:00';

  const video = $('#tpVideo');
  const canvas = $('#tpCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#09090a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (playable) {
    thumbDialog.showModal();
    const src = playableSrc(v);
    video.onerror = () => {
      setPickerTab('image');
      $('#tpBlocked').hidden = false;
      toast(t('to.framesfail'), 'err');
    };
    video.src = src;
    video.load();
    await new Promise((res) => {
      const done = () => {
        video.removeEventListener('loadedmetadata', done);
        res();
      };
      video.addEventListener('loadedmetadata', done);
      setTimeout(done, 15000);
    });
    const dur = isFinite(video.duration) ? video.duration : 0;
    $('#tpRange').max = dur || 100;
    $('#tpRange').step = dur > 300 ? 0.5 : 0.05;
    $('#tpMax').textContent = fmtTime(dur);
    thumbVideoReady = true;
    if (dur && !v.duration) patch(v.id, { duration: Math.round(dur) }, false);
    const start = v.startAt || Math.min(2, dur * 0.1) || 0;
    await jumpTo(start);
  } else {
    thumbDialog.showModal();
  }
}

function setPickerTab(which) {
  $('#tpTabFrame').classList.toggle('active', which === 'frame');
  $('#tpTabImage').classList.toggle('active', which === 'image');
  $('#tpFrame').hidden = which !== 'frame';
  $('#tpImage').hidden = which !== 'image';
}
$('#tpTabFrame').addEventListener('click', () => setPickerTab('frame'));
$('#tpTabImage').addEventListener('click', () => setPickerTab('image'));

const fmtMs = (s) => `${fmtTime(s)}.${String(Math.floor((s % 1) * 1000)).padStart(3, '0')}`;

async function jumpTo(t) {
  const video = $('#tpVideo');
  if (!thumbVideoReady) return;
  const dur = isFinite(video.duration) ? video.duration : 0;
  const target = dur ? clamp(t, 0, Math.max(0, dur - 0.1)) : Math.max(0, t);
  $('#tpRange').value = target;
  $('#tpRange').style.setProperty('--pct', (dur ? (target / dur) * 100 : 0) + '%');
  $('#tpOut').textContent = fmtMs(target);
  $('#tpTime').value = fmtTime(target);
  await seekPromise(video, target);
  drawFrame(video, $('#tpCanvas'));
}

$('#tpRange').addEventListener('input', (e) => jumpTo(parseFloat(e.target.value)));
const seekFromInput = () => {
  const val = parseTime($('#tpTime').value);
  if (val == null) {
    toast(t('to.timeformat'), 'err');
    return;
  }
  jumpTo(val);
};
$('#tpTime').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    seekFromInput();
  }
});
$('#tpTime').addEventListener('change', seekFromInput); // clicking away also seeks
$('#tpStepB').addEventListener('click', () => jumpTo(parseFloat($('#tpRange').value) - 1));
$('#tpStepF').addEventListener('click', () => jumpTo(parseFloat($('#tpRange').value) + 1));

$('#tpGrab').addEventListener('click', async () => {
  const t = Math.round(parseFloat($('#tpRange').value) || 0);
  const alsoStart = $('#tpAlsoStart').checked;
  const saved = await store.saveImage(drawFrame($('#tpVideo'), $('#tpCanvas')));
  await setThumbnail(thumbTarget.id, saved, 'frame', t);
  if (alsoStart) await patch(thumbTarget.id, { startAt: t }, false);
  thumbDialog.close();
});

$('#tpFrames').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-frame]');
  if (!btn) return;
  $$('#tpFrames .frame-opt').forEach((b) => b.classList.toggle('on', b === btn));
  const f = PROVIDERS[thumbTarget.provider].frames(thumbTarget)[+btn.dataset.frame];
  const saved = await store.saveImageFromUrl(f.url, thumbTarget.url);
  await setThumbnail(thumbTarget.id, saved, 'provider');
  thumbDialog.close();
});

$('#tpUseUrl').addEventListener('click', () => {
  const url = $('#tpUrl').value.trim();
  if (!url) return toast(t('to.pasteurl'), 'err');
  setThumbnail(thumbTarget.id, url, 'url');
  thumbDialog.close();
});

$('#tpReset').addEventListener('click', () => {
  patch(thumbTarget.id, { thumbnail: '', thumbSource: 'auto', thumbTime: null });
  thumbDialog.close();
});

$('#tpUpload').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const id = thumbTarget?.id || editing?.id;
  if (!id) return;
  const saved = await store.saveImage(await fileToDataUrl(file));
  await setThumbnail(id, saved, 'upload');
  if (thumbDialog.open) thumbDialog.close();
});

/* embeds cannot report duration from inside a cross-origin iframe; backfill it
   from the page metadata (itemprop/og/JSON-LD duration) for a few at a time */
async function autoDuration(v) {
  if (state.backend !== 'remote' || v.duration || v.kind === 'file') return;
  try {
    const meta = await (await fetch('/api/enrich?url=' + encodeURIComponent(v.url))).json();
    const cur = byId(v.id);
    if (meta.duration && cur && !cur.duration) {
      await patch(v.id, { duration: meta.duration }, false);
      render();
    }
  } catch {
    /* site exposes no duration — the stamp stays absent, honestly */
  }
}

/* capture a sensible first thumbnail for uploaded / direct video files */
async function autoThumbnail(v) {
  const src = playableSrc(v);
  if (!src || v.thumbnail) return;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  try {
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error('unreadable'));
      video.src = src;
      setTimeout(res, 20000);
    });
    const dur = isFinite(video.duration) ? video.duration : 0;
    const t = clamp(dur * 0.08, 1, dur ? Math.max(1, dur - 2) : 60);
    await seekPromise(video, t);
    if (!video.videoWidth) throw new Error('no frame');
    const canvas = document.createElement('canvas');
    const saved = await store.saveImage(drawFrame(video, canvas, 0.8));
    await patch(v.id, { thumbnail: saved, thumbSource: 'frame', thumbTime: Math.round(t), duration: Math.round(dur) }, false);
    render();
  } catch {
    /* leave the placeholder — the user can pick one manually */
  }
}

/* ========================================================= grid events */

$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const v = byId(card.dataset.id);
  if (state.selecting) return toggleSelect(v.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'edit') return openEdit(v.id);
  if (act === 'del') {
    return confirmBox(t('cf.title'), t('cf.card', { title: v.title })).then(async (yes) => {
      if (!yes) return;
      await store.remove(v.id);
      state.videos = state.videos.filter((x) => x.id !== v.id);
      state.selected.delete(v.id);
      render();
      toast(t('to.deleted'), '', 1800);
    });
  }
  if (act === 'rename') return;
  openPlayer(v.id);
});

$('#grid').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (!card || state.selecting) return;
  startRename(byId(card.dataset.id), e.target.closest('[data-act="rename"]'));
});

$('#grid').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const card = e.target.closest('.card');
  if (!card) return;
  state.selecting ? toggleSelect(card.dataset.id) : openPlayer(card.dataset.id);
});

/* ============================================ folders, selection, drag */

const DRAG_MIME = 'application/x-reelkeep-ids';

$('#grid').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const ids = state.selecting && state.selected.has(id) ? [...state.selected] : [id];
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
  // compact ghost parked ABOVE the pointer: the drop target under the cursor stays visible
  const ghost = $('#dragGhost');
  const label = ids.length > 1 ? t('count.other', { n: ids.length }) : byId(id)?.title || t('card.untitled');
  ghost.innerHTML = `<svg><use href="#i-folder" /></svg><span>${esc(label)}</span>`;
  e.dataTransfer.setDragImage(ghost, Math.round(ghost.offsetWidth / 2), ghost.offsetHeight + 14);
  document.body.classList.add('drag-ids');
  requestAnimationFrame(() => card.classList.add('dragging'));
});
function endDrag() {
  document.body.classList.remove('drag-ids');
  $('#dragGhost').innerHTML = '';
  $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
  $$('.chip.hot').forEach((c) => c.classList.remove('hot'));
}
$('#grid').addEventListener('dragend', endDrag);

async function moveIds(ids, folderId) {
  try {
    const n = await store.move(ids, folderId);
    state.videos.forEach((v) => {
      if (ids.includes(v.id)) v.folderId = folderId;
    });
    ids.forEach((id) => state.selected.delete(id));
    render();
    // render() detaches the dragged card, so native dragend may never reach #grid
    endDrag();
    const name = state.folders.find((f) => f.id === folderId)?.name || t('folder.unfiled');
    toast(t('move.moved', { n: t(n === 1 ? 'count.one' : 'count.other', { n }), name }), 'ok', 2200);
  } catch (err) {
    toast(t('move.fail', { err: err.message }), 'err');
  }
}

async function createFolderPrompt() {
  const name = (window.prompt(t('folder.prompt.new')) || '').trim();
  if (!name) return;
  try {
    const f = await store.createFolder(name);
    state.folders.push(f);
    render();
    toast(t('folder.created', { name }), 'ok', 1800);
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function renameFolderPrompt(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const name = (window.prompt(t('folder.prompt.rename'), f.name) || '').trim();
  if (!name || name === f.name) return;
  try {
    await store.renameFolder(id, name);
    f.name = name;
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const n = state.videos.filter((v) => v.folderId === id).length;
  if (!(await confirmBox(t('folder.delete.title', { name: f.name }), t('folder.delete.text', { n })))) return;
  try {
    await store.removeFolder(id);
    state.folders = state.folders.filter((x) => x.id !== id);
    const gone = state.videos.filter((v) => v.folderId === id).map((v) => v.id);
    state.videos = state.videos.filter((v) => v.folderId !== id);
    gone.forEach((vid) => state.selected.delete(vid));
    if (state.folder === id) state.folder = 'all';
    render();
    if (moveDialog.open) paintMoveList();
    toast(t('folder.deleted'), '', 1800);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderFolderActions() {
  const f = state.folders.find((x) => x.id === state.folder);
  const bar = $('#folderActions');
  bar.hidden = !f;
  if (!f) return;
  const n = state.videos.filter((v) => v.folderId === f.id).length;
  $('#faName').textContent = f.name;
  $('#faCount').textContent = t(n === 1 ? 'count.one' : 'count.other', { n });
  $('#faEmpty').disabled = !n;
}

$('#faEmpty').addEventListener('click', () => {
  const ids = state.videos.filter((v) => v.folderId === state.folder).map((v) => v.id);
  if (ids.length) moveIds(ids, '');
});
$('#faRename').addEventListener('click', () => renameFolderPrompt(state.folder));
$('#faDelete').addEventListener('click', () => deleteFolder(state.folder));

const folderbar = $('#folderbar');
folderbar.addEventListener('click', (e) => {
  if (e.target.closest('[data-newfolder]')) return createFolderPrompt();
  const chip = e.target.closest('[data-folder]');
  if (!chip) return;
  state.folder = chip.dataset.folder;
  state.limit = 60;
  render();
});
folderbar.addEventListener('dblclick', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (!chip || chip.dataset.folder === 'all' || chip.dataset.folder === 'unfiled') return;
  renameFolderPrompt(chip.dataset.folder);
});
folderbar.addEventListener('dragover', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (!chip || chip.dataset.folder === 'all' || !e.dataTransfer.types.includes(DRAG_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  chip.classList.add('hot');
});
folderbar.addEventListener('dragenter', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (chip && chip.dataset.folder !== 'all' && e.dataTransfer.types.includes(DRAG_MIME)) chip.classList.add('hot');
});
folderbar.addEventListener('dragleave', (e) => {
  const chip = e.target.closest('[data-folder]');
  // moving between a chip's own children must not clear the highlight
  if (chip && !chip.contains(e.relatedTarget)) chip.classList.remove('hot');
});
folderbar.addEventListener('drop', async (e) => {
  const chip = e.target.closest('[data-folder]');
  const raw = chip && e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return;
  e.preventDefault();
  chip.classList.remove('hot');
  const target = chip.dataset.folder === 'unfiled' ? '' : chip.dataset.folder;
  if (target === 'all') return;
  await moveIds(JSON.parse(raw), target);
});

$('#selectBtn').addEventListener('click', () => setSelecting(!state.selecting));
$('#selClear').addEventListener('click', () => setSelecting(false));
$('#selMove').addEventListener('click', openMove);

$('#pageMore').addEventListener('click', () => {
  state.limit += 60;
  render();
});

/* mobile overflow menu for the organization controls */
$('#menuBtn').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  $('#menuBtn').setAttribute('aria-pressed', String(open));
});
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('menu-open')) return;
  if (e.target.closest('.libhead-controls') || e.target.closest('#menuBtn')) return;
  document.body.classList.remove('menu-open');
  $('#menuBtn').setAttribute('aria-pressed', 'false');
});

const moveDialog = $('#moveDialog');
let moveTarget = '';

function paintMoveList() {
  $('#mvList').innerHTML =
    `<button type="button" class="move-opt${moveTarget === '' ? ' on' : ''}" data-mv=""><svg><use href="#i-folder" /></svg><span class="grow">${esc(t('folder.unfiled'))}</span></button>` +
    state.folders
      .map(
        (f) =>
          `<button type="button" class="move-opt${moveTarget === f.id ? ' on' : ''}" data-mv="${f.id}"><svg><use href="#i-folder" /></svg><span class="grow">${esc(f.name)}</span><span class="icon-btn" data-mv-edit="${f.id}" title="${esc(t('folder.rename'))}"><svg><use href="#i-edit" /></svg></span><span class="icon-btn" data-mv-del="${f.id}" title="${esc(t('folder.delete'))}"><svg><use href="#i-trash" /></svg></span></button>`,
      )
      .join('');
}

function openMove() {
  if (!state.selected.size) return;
  moveTarget = '';
  $('#mvNew').value = '';
  paintMoveList();
  moveDialog.showModal();
}

$('#mvList').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-mv-edit]');
  if (edit) return renameFolderPrompt(edit.dataset.mvEdit);
  const del = e.target.closest('[data-mv-del]');
  if (del) return deleteFolder(del.dataset.mvDel);
  const opt = e.target.closest('[data-mv]');
  if (!opt) return;
  moveTarget = opt.dataset.mv;
  paintMoveList();
});

$('#mvCreate').addEventListener('click', async () => {
  const name = $('#mvNew').value.trim();
  if (!name) return toast(t('move.noname'), 'err');
  try {
    const f = await store.createFolder(name);
    state.folders.push(f);
    moveTarget = f.id;
    $('#mvNew').value = '';
    paintMoveList();
    render();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#moveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ids = [...state.selected];
  if (!ids.length) return;
  const target = moveTarget;
  moveDialog.close();
  setSelecting(false);
  await moveIds(ids, target);
});

function startRename(v, el) {
  if (!v || !el) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = v.title || '';
  el.replaceWith(input);
  input.focus();
  input.select();
  let save = true;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      save = false;
      input.blur();
    }
  };
  input.onblur = () => {
    const next = input.value.trim();
    if (save && next && next !== v.title) patch(v.id, { title: next });
    else render();
  };
}

$('#tagbar').addEventListener('click', (e) => {
  if (e.target.closest('[data-tagreset]')) {
    state.tags.clear();
    state.limit = 60;
    render();
    return;
  }
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  const tag = chip.dataset.tag;
  state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
  state.limit = 60;
  render();
});

$('#search').addEventListener('input', (e) => {
  state.q = e.target.value;
  state.tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  state.limit = 60;
  render();
});

$('#sortSel').addEventListener('change', (e) => {
  state.sort = e.target.value;
  render();
});
$('#providerSel').addEventListener('change', (e) => {
  state.provider = e.target.value;
  state.limit = 60;
  render();
});

$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    const dlg = b.closest('dialog');
    dlg?.close();
    if (dlg === addDialog) $('#addSave').disabled = false;
  }),
);

[addDialog, editDialog, thumbDialog].forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }),
);

thumbDialog.addEventListener('close', () => {
  const video = $('#tpVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  thumbVideoReady = false;
});

/* ================================================== keyboard + drag/drop */

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (lb.open) {
    if (typing) return;
    if (e.key === 'ArrowRight') stepVideo(1);
    if (e.key === 'ArrowLeft') stepVideo(-1);
    if (e.key.toLowerCase() === 'f') $('[data-lb="full"]').click();
    return;
  }
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  }
  if (e.key.toLowerCase() === 'n' && !typing && !$$('dialog[open]').length) {
    e.preventDefault();
    openAdd();
  }
  if (e.key.toLowerCase() === 'v' && !typing && !$$('dialog[open]').length) applyView(state.view === 'grid' ? 'list' : 'grid');
  if (e.key.toLowerCase() === 'g' && !typing && !$$('dialog[open]').length) applyGroup(!state.group);
  if (e.key === 'Escape' && state.selecting && !$$('dialog[open]').length) setSelecting(false);
  if (e.key === 'Escape' && typing && document.activeElement === $('#search')) {
    $('#search').value = '';
    state.tokens = [];
    render();
  }
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    $('#dropzone').hidden = true;
    dragDepth = 0;
  }
});
window.addEventListener('drop', async (e) => {
  // internal card drags are handled by the folder chips, never by the upload/link path
  if (e.dataTransfer?.types?.includes(DRAG_MIME)) return;
  e.preventDefault();
  $('#dropzone').hidden = true;
  dragDepth = 0;
  const file = [...(e.dataTransfer?.files || [])].find((f) => /^(video|audio)\//.test(f.type) || MEDIA_EXT.test(f.name));
  if (!file) {
    const link = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (link && parseUrl(link)) {
      openAdd('link');
      $('#addUrl').value = link;
      enrich(link);
      updateSave();
    } else if (link && /<iframe/i.test(link)) {
      openAdd('embed');
      $('#addEmbed').value = link;
      $('#addEmbed').dispatchEvent(new Event('input'));
    }
    return;
  }
  openAdd('upload');
  pickedFile = file;
  $('#dropLabel').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  $('#pvTitle').value = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  draft.title = $('#pvTitle').value;
  setDetected(file.name, `${(file.size / 1048576).toFixed(1)} MB`, true);
  paintPreview();
  updateSave();
});

/* ============================================================= boot */

function setBackend(mode) {
  state.backend = mode;
  const el = $('#backend');
  el.className = 'dot ' + (mode === 'remote' ? 'live' : 'local');
  const demo = /(^|\.)github\.io$/.test(location.hostname);
  el.textContent = mode === 'remote' ? t('foot.remote') : t('foot.local');
  $('#topDot').className = 'dot ' + (mode === 'remote' ? 'live' : 'local');
  $('#topStatus').textContent = mode === 'remote' ? t('top.status.live') : t('top.status.local');
  $('#tip').textContent = mode === 'remote' ? t('foot.tip.remote') : demo ? t('foot.tip.demo') : t('foot.tip.local');
}

async function boot() {
  let savedView = 'grid';
  try {
    savedView = localStorage.getItem(VIEW_KEY) || 'grid';
  } catch {
    /* storage blocked */
  }
  applyView(savedView);
  let savedGroup = false;
  try {
    savedGroup = localStorage.getItem(GROUP_KEY) === '1';
  } catch {
    /* storage blocked */
  }
  applyGroup(savedGroup);
  $('#langSel').value = i18nCurrent();
  try {
    const probe = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (!probe.ok) throw new Error();
    setBackend('remote');
  } catch {
    setBackend('local');
  }
  try {
    const lib = await store.load();
    state.videos = lib.videos;
    state.folders = lib.folders;
  } catch (err) {
    state.videos = [];
    toast(t('to.loadfail', { err: err.message }), 'err');
  }
  // Browser-only mode (GitHub Pages demo, file://): start from the example
  // library once, so a first visit is never an empty grid.
  if (state.backend !== 'remote' && !state.videos.length) {
    let touched = true;
    try {
      touched = localStorage.getItem(LS_KEY) !== null;
    } catch {
      /* storage blocked */
    }
    if (!touched) {
      try {
        const res = await fetch('data/videos.example.json');
        if (res.ok) {
          const db = await res.json();
          state.videos = db.videos || [];
          state.folders = db.folders || [];
          localLib.write({ videos: state.videos, folders: state.folders });
        }
      } catch {
        /* offline or file:// — an empty gallery is fine */
      }
    }
  }
  render();
  // give playable videos without a cover their default frame (the opening shot)
  const missing = state.videos.filter((v) => !v.thumbnail && v.kind === 'file').slice(0, 4);
  missing.forEach((v, i) => setTimeout(() => autoThumbnail(v), 400 + i * 700));
  const noDur = state.videos.filter((v) => !v.duration && v.kind !== 'file').slice(0, 4);
  noDur.forEach((v, i) => setTimeout(() => autoDuration(v), 800 + i * 900));
}

boot();
