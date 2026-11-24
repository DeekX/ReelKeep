/* ReelKeep importers — pure parsers, node-testable, hostile-input safe.
   Every parser returns { items, errors }; items are universal-shaped inputs
   (type/title/url/tags/notes/createdAt). Nothing here touches storage. */

import { hostOf, parseUrl } from './util.mjs';

const clean = (s, max = 300) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(#?[a-z0-9]+);/gi, (m, key) => ENTITIES[key.toLowerCase()] ?? m);

function pushItem(out, { type = 'link', title, url, tags = [], notes = '', createdAt = null }) {
  const u = parseUrl(url);
  if (!u || !/^https?:$/.test(u.protocol)) {
    out.errors.push(`skipped non-http url: ${clean(url, 120)}`);
    return;
  }
  out.items.push({
    type,
    title: clean(title) || u.hostname,
    url: u.href,
    tags: tags.map((t) => clean(t, 40).replace(/^#/, '')).filter(Boolean).slice(0, 12),
    notes: clean(notes, 5000),
    createdAt: createdAt && !isNaN(Date.parse(createdAt)) ? new Date(createdAt).toISOString() : null,
    site: u.hostname.replace(/^www\./, ''),
  });
}

/** Netscape bookmarks HTML (browser exports, Pocket HTML exports). */
export function parseBookmarksHtml(text, out = { items: [], errors: [] }) {
  let m;
  // track folder names via preceding <H3> headers (best-effort, flat tags)
  const lines = String(text || '');
  let currentFolder = '';
  const tokenRe = /<H3[^>]*>([\s\S]*?)<\/H3>|<A\s+([^>]*?)>([\s\S]*?)<\/A>/gi;
  while ((m = tokenRe.exec(lines))) {
    if (m[1] != null) {
      currentFolder = clean(decode(m[1]), 60);
      continue;
    }
    const attrs = m[2] || '';
    const href = /HREF\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] || /HREF\s*=\s*'([^']*)'/i.exec(attrs)?.[1] || '';
    const addDate = /ADD_DATE\s*=\s*"(\d+)"/i.exec(attrs)?.[1];
    const tags = /TAGS\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.split(',').filter(Boolean) || [];
    if (currentFolder) tags.push(currentFolder);
    const decoded = href.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    pushItem(out, {
      title: decode(m[3].replace(/<[^>]+>/g, '')),
      url: decoded,
      tags,
      createdAt: addDate ? new Date(Number(addDate) * 1000).toISOString() : null,
    });
  }
  return out;
}

/** Raindrop.io CSV export: id,title,note,excerpt,cover,url,folder,tags,created,... */
export function parseRaindropCsv(text, out = { items: [], errors: [] }) {
  const rows = parseCsv(String(text || ''));
  if (!rows.length) return out;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const iUrl = col('url');
  const iTitle = col('title');
  const iNote = col('note');
  const iTags = col('tags');
  const iFolder = col('folder');
  const iCreated = col('created');
  if (iUrl < 0) {
    out.errors.push('raindrop csv: no url column');
    return out;
  }
  for (const row of rows.slice(1)) {
    const tags = (row[iTags] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (row[iFolder]) tags.push(row[iFolder]);
    pushItem(out, {
      title: row[iTitle],
      url: row[iUrl],
      notes: row[iNote],
      tags,
      createdAt: row[iCreated] || null,
    });
  }
  return out;
}

/** Minimal RFC4180 CSV: quotes, escaped quotes, CRLF, embedded newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

/** Pocket export: HTML bookmarks (part-*.html) or the JSON list variant. */
export function parsePocket(text, out = { items: [], errors: [] }) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      const list = Array.isArray(data) ? data : data.list ? Object.values(data.list) : [];
      for (const e of list) {
        pushItem(out, {
          title: e.resolved_title || e.given_title,
          url: e.resolved_url || e.given_url,
          tags: Object.keys(e.tags || {}),
          createdAt: e.time_added ? new Date(Number(e.time_added) * 1000).toISOString() : null,
        });
      }
      return out;
    } catch {
      out.errors.push('pocket json: malformed');
      return out;
    }
  }
  return parseBookmarksHtml(trimmed, out);
}

/** Karakeep export: { bookmarks: [{ content: { url, title, ... }, tags, ... }] } */
export function parseKarakeep(text, out = { items: [], errors: [] }) {
  try {
    const data = JSON.parse(String(text || ''));
    const list = data.bookmarks || data.items || [];
    for (const b of list) {
      const c = b.content || {};
      pushItem(out, {
        type: c.type === 'video' ? 'video' : c.type === 'image' ? 'image' : 'link',
        title: c.title || b.title,
        url: c.url || b.url,
        tags: (b.tags || []).map((t) => (typeof t === 'string' ? t : t.name)),
        notes: b.note || '',
        createdAt: b.createdAt || null,
      });
    }
  } catch {
    out.errors.push('karakeep json: malformed');
  }
  return out;
}

/** Linkwarden export: { links: [{ url, name, description, tags, collection }] } */
export function parseLinkwarden(text, out = { items: [], errors: [] }) {
  try {
    const data = JSON.parse(String(text || ''));
    const list = data.links || [];
    for (const l of list) {
      const tags = (l.tags || []).map((t) => (typeof t === 'string' ? t : t.name));
      if (l.collection?.name) tags.push(l.collection.name);
      pushItem(out, { title: l.name, url: l.url, notes: l.description, tags, createdAt: l.createdAt || null });
    }
  } catch {
    out.errors.push('linkwarden json: malformed');
  }
  return out;
}

/** YouTube Takeout: playlists JSON (playlistItems with snippet.resourceId.videoId). */
export function parseTakeout(text, out = { items: [], errors: [] }) {
  try {
    const data = JSON.parse(String(text || ''));
    const lists = Array.isArray(data) ? data : [data];
    for (const pl of lists) {
      const entries = pl.playlistItems || pl.items || [];
      const plName = pl.snippet?.title || pl.title || '';
      for (const e of entries) {
        const sn = e.snippet || {};
        const vid = sn.resourceId?.videoId || e.videoId;
        if (!vid) continue;
        pushItem(out, {
          type: 'video',
          title: sn.title,
          url: `https://www.youtube.com/watch?v=${vid}`,
          tags: plName ? [plName] : [],
          notes: sn.description || '',
          createdAt: sn.publishedAt || null,
        });
      }
    }
  } catch {
    out.errors.push('takeout json: malformed');
  }
  return out;
}

/** Plain URL list: one per line, optional `# tag` suffixes and `title | url`. */
export function parseUrlList(text, out = { items: [], errors: [] }) {
  for (const line of String(text || '').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const [maybeTitle, maybeUrl] = s.includes('|') ? s.split('|').map((x) => x.trim()) : [null, s];
    pushItem(out, { title: maybeTitle, url: maybeUrl });
  }
  return out;
}

/** Sniff the format from content + filename. */
export function detectFormat(text, name = '') {
  const t = String(text || '').trim();
  const n = name.toLowerCase();
  if (/\.csv$/.test(n) || /^id,title,/.test(t)) return 'raindrop';
  if (/\.html?$/.test(n) || /<!DOCTYPE NETSCAPE-Bookmark-file/i.test(t) || /<A\s+HREF/i.test(t)) {
    return /pocket/i.test(n) ? 'pocket' : 'bookmarks';
  }
  if (t.startsWith('{') || t.startsWith('[')) {
    if (/"bookmarks"\s*:/.test(t) && /"content"\s*:/.test(t)) return 'karakeep';
    if (/"links"\s*:/.test(t)) return 'linkwarden';
    if (/"playlistItems"\s*:|"resourceId"\s*:/.test(t)) return 'takeout';
    if (/"resolved_url"\s*:|"given_url"\s*:/.test(t)) return 'pocket';
    if (/"schemaVersion"\s*:/.test(t)) return 'reelkeep';
    return 'json?';
  }
  return 'urls';
}

export const PARSERS = {
  bookmarks: parseBookmarksHtml,
  raindrop: parseRaindropCsv,
  pocket: parsePocket,
  karakeep: parseKarakeep,
  linkwarden: parseLinkwarden,
  takeout: parseTakeout,
  urls: parseUrlList,
};

export const hostOfImport = hostOf;
