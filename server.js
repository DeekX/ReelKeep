/**
 * ReelKeep server — no dependencies, Node 18+.
 *   node server.js            http://localhost:5178
 *   PORT=8080 node server.js
 *
 * Persistence is the universal library (data/library.json, schema v2) behind
 * lib/store.js. Legacy data/videos.json is read and migrated forward with a
 * backup; the /api/videos* routes remain as a compatibility surface.
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { createStore } = require('./lib/store');
const { safeFetch } = require('./lib/safefetch');
const { httpError } = require('./lib/ssrf');
const { extractSnapshot } = require('./lib/snapshot');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const THUMB_DIR = path.join(ROOT, 'thumbnails');
const VIDEO_DIR = path.join(ROOT, 'videos');
const FILE_DIR = path.join(ROOT, 'files');
const JS_DIR = path.join(ROOT, 'js');
const PORT = Number(process.env.PORT || 5178);
const HOST = process.env.HOST || '127.0.0.1';

const MAX_JSON = 64 * 1024 * 1024;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 2048) * 1024 * 1024;
const FETCH_TIMEOUT = 12000;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

// Only the UI and the media folders are reachable over HTTP. The library JSON,
// the server source and repo internals (.git, package.json, …) must never be
// served — HOST=0.0.0.0 puts this server on the LAN.
const PUBLIC_FILES = new Set(['index.html', 'player.html', 'app.js', 'styles.css', 'i18n.js']);
const PUBLIC_DIRS = [THUMB_DIR, VIDEO_DIR, FILE_DIR, JS_DIR];
const UPLOAD_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg', '.mov', '.mkv', '.mp3', '.m4a', '.wav']);

[DATA_DIR, THUMB_DIR, VIDEO_DIR, FILE_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

let store; // universal persistence, initialized before listen
let schema; // shared schema helpers (ESM, loaded by the store)

/* ------------------------------------------------------------ utils */

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_JSON) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function inside(dir, target) {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** magic-byte content sniffing (upload intake never trusts the extension alone) */
function sniffMime(buf) {
  if (!buf || buf.length < 12) return '';
  const s = (a, b) => buf.toString('latin1', a, b);
  if (buf[0] === 0x89 && s(1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (s(0, 4) === 'GIF8') return 'image/gif';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'image/webp';
  if (s(4, 8) === 'ftyp') return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (s(0, 4) === 'OggS') return 'audio/ogg';
  if (s(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s(0, 4) === '%PDF') return 'application/pdf';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return 'audio/wav';
  return '';
}

function extFromMime(type = '') {
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('avif')) return '.avif';
  return '.jpg';
}

const coverFileOf = (item) =>
  item.cover?.kind === 'file' && /^thumbnails\//.test(item.cover.path || '') ? item.cover.path : null;

async function removeCover(item) {
  const rel = coverFileOf(item);
  if (rel && schema.isSafeRelPath(rel)) await fsp.rm(path.join(ROOT, rel), { force: true });
}

/* ------------------------------------------------------- page metadata */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&(#?[a-z0-9]+);/gi, (m, key) => ENTITIES[key.toLowerCase()] ?? m);
}

function metaTag(html, attr, value) {
  const re = new RegExp(`<meta[^>]+${attr}=["']${value}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!content) return null;
  return decodeEntities(content[2] ?? content[3] ?? content[4] ?? '').trim() || null;
}

function absUrl(value, base) {
  if (!value) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/** ISO-8601 (PT10M35S, PT1H2M3S, P1DT…) or plain seconds → seconds */
function parseDuration(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?$/i.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return null;
  return Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + parseFloat(m[4] || 0));
}

async function enrich(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const { res, finalUrl } = await safeFetch(target, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        // bypass EU consent walls that otherwise return a cookie-less shell page
        Cookie: 'CONSENT=YES+1; SOCS=CAI',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const type = res.headers.get('content-type') || '';

    if (/^(video|audio)\//.test(type) || /\.(mp4|webm|ogv|mov|m4v|mp3)(\?|$)/i.test(finalUrl)) {
      return { pageUrl: finalUrl, mediaUrl: finalUrl, title: finalUrl.split('/').pop(), direct: true };
    }
    if (!res.ok) throw Object.assign(new Error(`site returned ${res.status}`), { status: 502 });
    if (!type.includes('html') && !type.includes('xml')) {
      return { pageUrl: finalUrl, title: null, image: null, note: 'page is not html' };
    }
    if (!res.body) return { pageUrl: finalUrl, title: null, image: null, note: 'empty response body' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let html = '';
    let bytes = 0;
    const cap = 2 * 1024 * 1024;
    while (bytes < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytes += value.length;
      // stop early only once head metadata AND a duration marker are present;
      // YouTube keeps duration in body JSON (lengthSeconds), past </head>
      if (
        />$/.test(html) &&
        /<\/head>/i.test(html) &&
        /og:image|twitter:image/i.test(html) &&
        /duration|lengthSeconds/i.test(html)
      )
        break;
    }
    try {
      reader.cancel();
    } catch (_) {
      /* already done */
    }

    const title =
      metaTag(html, 'property', 'og:title') ||
      metaTag(html, 'name', 'twitter:title') ||
      metaTag(html, 'property', 'video:other_url_title') ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() ||
      null;

    const image =
      metaTag(html, 'property', 'og:image:secure_url') ||
      metaTag(html, 'property', 'og:image:url') ||
      metaTag(html, 'property', 'og:image') ||
      metaTag(html, 'name', 'twitter:image:src') ||
      metaTag(html, 'name', 'twitter:image') ||
      metaTag(html, 'property', 'video:thumbnail');

    const videoCandidates = [
      metaTag(html, 'property', 'og:video:secure_url'),
      metaTag(html, 'property', 'og:video:url'),
      metaTag(html, 'property', 'og:video'),
      metaTag(html, 'name', 'twitter:player:stream'),
      metaTag(html, 'property', 'og:embeddable:video'),
      html.match(/"contentUrl"\s*:\s*"(https?:\/\/[^"]+\.(?:mp4|webm|ogv)[^"]*)"/i)?.[1],
    ].filter(Boolean).map((u) => absUrl(u.replace(/\\\//g, '/'), finalUrl));

    let duration = parseDuration(
      metaTag(html, 'itemprop', 'duration') ||
        metaTag(html, 'property', 'og:video:duration') ||
        metaTag(html, 'property', 'video:duration') ||
        html.match(/"duration"\s*:\s*"(P[^"]+)"/i)?.[1] ||
        html.match(/"duration"\s*:\s*(\d+(?:\.\d+)?)\s*[,}]/)?.[1] ||
        html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1],
    );
    if (!duration) {
      const ms = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/)?.[1];
      if (ms) duration = Math.round(Number(ms) / 1000);
    }
    // Vimeo pages expose no duration meta; its oEmbed API does
    if (!duration) {
      try {
        const host = new URL(finalUrl).hostname;
        if (/(^|\.)vimeo\.com$/.test(host)) {
          const { res: oe } = await safeFetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(finalUrl)}`, {
            signal: controller.signal,
            headers: { 'User-Agent': UA },
          });
          if (oe.ok) duration = parseDuration((await oe.json()).duration);
        }
      } catch {
        /* oEmbed unavailable — the stamp stays absent, honestly */
      }
    }

    const linkIcon = html.match(
      /<link[^>]+rel\s*=\s*["'](?:icon|apple-touch-icon|shortcut icon)["'][^>]*>/i,
    )?.[0];
    const href = linkIcon?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];

    let siteName = metaTag(html, 'property', 'og:site_name');
    if (!siteName) {
      try {
        siteName = new URL(finalUrl).hostname.replace(/^www\./, '');
      } catch {
        siteName = null;
      }
    }

    return {
      pageUrl: finalUrl,
      title: title || siteName,
      image: absUrl(image, finalUrl),
      favicon: absUrl(href, finalUrl),
      siteName,
      description:
        metaTag(html, 'property', 'og:description') ||
        metaTag(html, 'name', 'twitter:description') ||
        metaTag(html, 'name', 'description') ||
        null,
      author: metaTag(html, 'name', 'author') || metaTag(html, 'property', 'article:author') || null,
      publishedAt: metaTag(html, 'property', 'article:published_time') || null,
      mediaUrl: videoCandidates.find((u) => /\.(mp4|webm|ogv|mov|m4v|mp3)(\?|$)/i.test(u)) || null,
      embedPageUrl: videoCandidates.find((u) => !/\.(mp4|webm|ogv|mov|m4v|mp3)(\?|$)/i.test(u)) || null,
      isVideoPage: /video|movie/i.test(metaTag(html, 'property', 'og:type') || ''),
      duration,
      direct: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------- media proxy */

const MAX_MEDIA = Number(process.env.MAX_MEDIA_MB || 4096) * 1024 * 1024;

async function proxyMedia(req, res, target, referer) {
  const headers = { 'User-Agent': UA, Referer: referer || target };
  if (req.headers.range) headers.Range = req.headers.range;
  let upstream;
  try {
    upstream = (await safeFetch(target, { headers, timeoutMs: 30000 })).res;
  } catch (err) {
    if (res.headersSent) return res.end();
    return send(res, err.status || 502, { error: `cannot reach that host (${err.cause?.code || err.message})` });
  }
  const upType = upstream.headers.get('content-type') || '';
  if (upstream.ok && !/^(video|audio)\//.test(upType) && !/^(application\/(octet-stream|mp4|ogg|webm))/.test(upType)) {
    upstream.body?.cancel().catch(() => {});
    return send(res, 415, { error: `not a media stream (${upType || 'unknown'})` });
  }
  const out = {
    'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Upstream-Status': String(upstream.status),
  };
  // Only Content-Range is copied: it carries the total size the player needs to seek.
  // Content-Length is deliberately omitted so a truncated upstream stream can never
  // mismatch the declared length and kill the response.
  const rangeHeader = upstream.headers.get('content-range');
  if (rangeHeader) out['Content-Range'] = rangeHeader;
  res.writeHead(upstream.status === 404 ? 404 : upstream.status === 206 ? 206 : upstream.ok ? upstream.status : 502, out);
  if (!upstream.body) return res.end();
  await new Promise((resolve) => {
    const src = Readable.fromWeb(upstream.body);
    let bytes = 0;
    src.on('data', (c) => {
      bytes += c.length;
      if (bytes > MAX_MEDIA) src.destroy(new Error('media stream over cap'));
    });
    src.on('error', () => resolve()); // client disconnect / upstream cut / cap: end quietly
    res.on('close', () => src.destroy());
    src.pipe(res).on('close', resolve);
  });
}

/* ------------------------------------------------------------- upload */

async function saveUpload(req, declaredName) {
  let raw = declaredName || '';
  try {
    raw = decodeURIComponent(raw);
  } catch (_) {
    /* already decoded */
  }
  const ext = path.extname(raw).toLowerCase();
  const safeExt = UPLOAD_EXT.has(ext) ? ext : '.mp4';
  const name = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}${safeExt}`;
  const file = path.join(VIDEO_DIR, name);
  const ws = fs.createWriteStream(file);
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_UPLOAD) throw Object.assign(new Error('file too large'), { status: 413 });
      if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
    }
  } catch (err) {
    ws.destroy();
    await fsp.rm(file, { force: true });
    throw err;
  }
  await new Promise((r) => ws.end(r));
  return { fileUrl: `/videos/${name}`, fileName: name, size };
}

/* -------------------------------------------------------------- static */

function serveStatic(req, res, absPath, relFromRoot, inline = false) {
  fs.stat(absPath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: 'not found' });
    // never follow a symlink out of the allowed roots
    fs.realpath(absPath, (err2, real) => {
      if (err2) return send(res, 404, { error: 'not found' });
      const allowed = PUBLIC_FILES.has(relFromRoot) || PUBLIC_DIRS.some((d) => inside(d, real));
      if (!allowed) return send(res, 404, { error: 'not found' });
      const type = MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream';
      const headers = {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': absPath.startsWith(VIDEO_DIR) || absPath.startsWith(FILE_DIR) ? 'no-store' : 'no-cache',
      };
      // generic files download rather than render in the app origin; inline is
      // only honored for viewer-safe kinds (pdf/image/media), never web content
      const inlineSafe = /^(image\/|video\/|audio\/|application\/pdf)/.test(type);
      if (absPath.startsWith(FILE_DIR) && !(inline && inlineSafe)) headers['Content-Disposition'] = 'attachment';
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let start;
        let end;
        if (range[1]) {
          start = Number(range[1]);
          end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
        } else {
          start = Math.max(0, stat.size - Number(range[2]));
          end = stat.size - 1;
        }
        if (start >= stat.size || end < start) {
          return res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        return fs.createReadStream(absPath, { start, end }).on('error', () => res.end()).pipe(res);
      }
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
      fs.createReadStream(absPath).on('error', () => res.end()).pipe(res);
    });
  });
}

/* --------------------------------------------------------------- routes */

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    if (p.startsWith('/api/') || p === '/media') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') return res.writeHead(204).end();

      // CSRF: any website can reach a loopback server, so state-changing requests
      // must come from our own origin. Browsers always send Origin on cross-origin
      // writes; non-browser clients (tests, curl) send none and stay allowed.
      if (req.method !== 'GET' && req.headers.origin) {
        let originHost = null;
        try {
          originHost = new URL(req.headers.origin).host;
        } catch {
          /* malformed Origin: refuse below */
        }
        if (originHost !== req.headers.host) {
          return send(res, 403, { error: 'cross-origin writes are not allowed' });
        }
      }

      /* -------------------------------------------- universal library */

      if (p === '/api/library' && req.method === 'GET') {
        const lib = await store.load();
        return send(res, 200, { library: lib, readOnly: store.isReadOnly() });
      }

      if (p === '/api/library' && req.method === 'PUT') {
        const body = await readJson(req);
        const res2 = store.migrations.migrateLibrary(body, { now: new Date().toISOString() });
        if (res2.invalid) return send(res, 400, { error: 'not a library' });
        if (res2.readOnly) return send(res, 409, { error: 'library was written by a newer ReelKeep version' });
        const check = schema.validateLibrary(res2.data);
        if (!check.ok) return send(res, 400, { error: check.error });
        await store.write(res2.data);
        return send(res, 200, { ok: true });
      }

      if (p === '/api/items' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body || typeof body.type !== 'string') return send(res, 400, { error: 'item needs a type' });
        const now = new Date().toISOString();
        const item = { ...body, id: body.id || schema.newId('i'), createdAt: body.createdAt || now, updatedAt: now };
        if (item.cover?.kind === 'file' && !schema.isSafeRelPath(item.cover.path)) {
          return send(res, 400, { error: 'unsafe cover path' });
        }
        const lib = await store.load();
        lib.items.unshift(item);
        await store.write(lib);
        return send(res, 201, { item });
      }

      const imatch = /^\/api\/items\/([\w-]+)$/.exec(p);
      if (imatch && imatch[1] !== 'move') {
        const lib = await store.load();
        const idx = lib.items.findIndex((v) => v.id === imatch[1]);
        if (idx === -1) return send(res, 404, { error: 'no such item' });
        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const prev = lib.items[idx];
          lib.items[idx] = { ...prev, ...body, id: prev.id, data: { ...prev.data, ...(body.data || {}) }, updatedAt: new Date().toISOString() };
          await store.write(lib);
          return send(res, 200, { item: lib.items[idx] });
        }
        if (req.method === 'DELETE') {
          const [gone] = lib.items.splice(idx, 1);
          await removeCover(gone);
          await store.write(lib);
          return send(res, 200, { ok: true });
        }
      }

      if ((p === '/api/items/move' || p === '/api/videos/move') && req.method === 'POST') {
        const { ids, folderId } = await readJson(req);
        if (!Array.isArray(ids)) return send(res, 400, { error: 'ids must be an array' });
        const lib = await store.load();
        const target = folderId || null;
        if (target && !lib.folders.some((f) => f.id === target)) return send(res, 404, { error: 'no such folder' });
        let moved = 0;
        lib.items.forEach((v) => {
          if (ids.includes(v.id)) {
            v.folderId = target;
            moved++;
          }
        });
        await store.write(lib);
        return send(res, 200, { moved });
      }

      if (p === '/api/files' && req.method === 'DELETE') {
        const rel = url.searchParams.get('path') || '';
        if (!schema.isSafeRelPath(rel) || !/^(thumbnails|videos|files)\//.test(rel)) {
          return send(res, 400, { error: 'unsafe file path' });
        }
        await fsp.rm(path.join(ROOT, rel), { force: true });
        return send(res, 200, { ok: true });
      }

      if (p === '/api/backups' && req.method === 'GET') {
        return send(res, 200, { backups: await store.listBackups() });
      }
      if (p === '/api/backups' && req.method === 'POST') {
        const body = await readJson(req).catch(() => ({}));
        const name = await store.createBackup(body.reason || 'manual');
        return send(res, 201, { name });
      }

      /* ------------------------------------- legacy v1 compatibility */

      if (p === '/api/state' && req.method === 'GET') {
        const lib = await store.load();
        return send(res, 200, {
          version: 1,
          videos: lib.items.filter((i) => i.type === 'video').map(schema.itemToLegacy),
          folders: lib.folders.map(schema.legacyFolderView),
        });
      }

      if (p === '/api/folders' && req.method === 'POST') {
        const body = await readJson(req);
        const name = String(body.name || '').trim().slice(0, 60);
        if (!name) return send(res, 400, { error: 'folder needs a name' });
        const folder = { id: schema.newId('f'), name, createdAt: new Date().toISOString() };
        const lib = await store.load();
        folder.order = lib.folders.length;
        lib.folders.push(folder);
        await store.write(lib);
        return send(res, 201, { folder: schema.legacyFolderView(folder) });
      }

      const fmatch = /^\/api\/folders\/([\w-]+)$/.exec(p);
      if (fmatch) {
        const lib = await store.load();
        const idx = lib.folders.findIndex((f) => f.id === fmatch[1]);
        if (idx === -1) return send(res, 404, { error: 'no such folder' });
        if (req.method === 'PATCH') {
          const body = await readJson(req);
          const name = String(body.name || '').trim().slice(0, 60);
          if (!name) return send(res, 400, { error: 'folder needs a name' });
          lib.folders[idx] = { ...lib.folders[idx], name };
          await store.write(lib);
          return send(res, 200, { folder: schema.legacyFolderView(lib.folders[idx]) });
        }
        if (req.method === 'DELETE') {
          const id = fmatch[1];
          lib.folders.splice(idx, 1);
          const gone = lib.items.filter((v) => v.folderId === id);
          lib.items = lib.items.filter((v) => v.folderId !== id);
          await store.write(lib);
          for (const v of gone) await removeCover(v);
          return send(res, 200, { ok: true, deleted: gone.length });
        }
      }

      if (p === '/api/videos' && req.method === 'POST') {
        const body = await readJson(req);
        const now = new Date().toISOString();
        const item = schema.legacyToItem(
          { ...body, id: undefined, addedAt: now, lastOpenedAt: null },
          { id: schema.newId('v'), now },
        );
        const lib = await store.load();
        lib.items.unshift(item);
        await store.write(lib);
        return send(res, 201, { video: schema.itemToLegacy(item) });
      }

      const match = /^\/api\/videos\/([\w-]+)$/.exec(p);
      if (match && match[1] !== 'upload' && match[1] !== 'move') {
        const lib = await store.load();
        const idx = lib.items.findIndex((v) => v.id === match[1]);
        if (idx === -1) return send(res, 404, { error: 'no such video' });
        if (req.method === 'PATCH') {
          const body = await readJson(req);
          schema.applyLegacyPatch(lib.items[idx], body);
          await store.write(lib);
          return send(res, 200, { video: schema.itemToLegacy(lib.items[idx]) });
        }
        if (req.method === 'DELETE') {
          const [gone] = lib.items.splice(idx, 1);
          await removeCover(gone);
          await store.write(lib);
          return send(res, 200, { ok: true });
        }
      }

      /* ---------------------------------------------- media & covers */

      if (p === '/api/thumbnails' && req.method === 'POST') {
        const { dataUrl } = await readJson(req);
        const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(dataUrl || '');
        if (!m) return send(res, 400, { error: 'expected a data:image URL' });
        const ext = m[1].toLowerCase() === 'png' ? '.png' : extFromMime(m[1]);
        const name = `thumbnails/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
        await fsp.writeFile(path.join(ROOT, name), Buffer.from(m[2], 'base64'));
        return send(res, 201, { thumbnail: name });
      }

      if (p === '/api/thumbnails/from-url' && req.method === 'POST') {
        const { url: image, referer } = await readJson(req);
        if (!/^https?:\/\//i.test(image || '')) return send(res, 400, { error: 'need an http(s) image url' });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        let buf;
        let type;
        try {
          const upstream = (await safeFetch(image, { signal: controller.signal, headers: { 'User-Agent': UA, Referer: referer || image } })).res;
          if (!upstream.ok) throw Object.assign(new Error(`image host returned ${upstream.status}`), { status: 502 });
          type = (upstream.headers.get('content-type') || '').split(';')[0];
          if (!type.startsWith('image/')) throw Object.assign(new Error(`not an image (${type || 'unknown'})`), { status: 415 });
          buf = Buffer.from(await upstream.arrayBuffer());
        } finally {
          clearTimeout(timer);
        }
        if (buf.length > 15 * 1024 * 1024) return send(res, 413, { error: 'image larger than 15 MB' });
        // extension comes from the content type only — a hostile URL path must
        // never decide how a file is served (stored-XSS via .html "images")
        const ext = extFromMime(type);
        const name = `thumbnails/${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext}`;
        await fsp.writeFile(path.join(ROOT, name), buf);
        return send(res, 201, { thumbnail: name });
      }

      if (p === '/api/videos/upload' && req.method === 'POST') {
        return send(res, 201, await saveUpload(req, req.headers['x-file-name']));
      }

      /* Generic file intake for any item type. Content is sniffed as well as
         extension-checked; web-executable types are refused outright. */
      if (p === '/api/files' && req.method === 'POST') {
        const dir = url.searchParams.get('dir') || 'files';
        if (!['files', 'videos', 'thumbnails'].includes(dir)) return send(res, 400, { error: 'unknown file dir' });
        let raw = req.headers['x-file-name'] || '';
        try {
          raw = decodeURIComponent(raw);
        } catch {
          /* already decoded */
        }
        const ext = path.extname(raw).toLowerCase();
        const WEB_EXEC = new Set(['.html', '.htm', '.xhtml', '.svg', '.js', '.mjs', '.css', '.xml', '.xsl', '.swf']);
        if (dir === 'files' && WEB_EXEC.has(ext)) return send(res, 415, { error: 'web-executable files are not accepted' });
        if (dir === 'videos' && !UPLOAD_EXT.has(ext)) return send(res, 415, { error: 'not a media extension' });
        const cap = dir === 'thumbnails' ? 15 * 1024 * 1024 : MAX_UPLOAD;
        const name = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}${ext || '.bin'}`;
        const rel = `${dir}/${name}`;
        const file = path.join(ROOT, rel);
        const ws = fs.createWriteStream(file);
        let size = 0;
        let head = Buffer.alloc(0);
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > cap) throw httpError(413, 'file too large');
            if (head.length < 512) head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
            if (!ws.write(chunk)) await new Promise((r) => ws.once('drain', r));
          }
        } catch (err) {
          ws.destroy();
          await fsp.rm(file, { force: true });
          throw err;
        }
        await new Promise((r) => ws.end(r));
        const sniff = head.toString('latin1').trimStart().toLowerCase();
        const looksWeb = sniff.startsWith('<!doctype html') || sniff.startsWith('<html') || sniff.startsWith('<script') || sniff.startsWith('<?xml');
        const mime = sniffMime(head);
        if (looksWeb || (dir === 'thumbnails' && !mime.startsWith('image/'))) {
          await fsp.rm(file, { force: true });
          return send(res, 415, { error: 'content does not match the file kind' });
        }
        return send(res, 201, { path: rel, size, mime: mime || MIME[ext] || 'application/octet-stream' });
      }

      /* Opt-in reader snapshot: text blocks only, sanitized by construction. */
      if (p === '/api/snapshot' && req.method === 'POST') {
        const { url: target } = await readJson(req);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
        try {
          const { res: page, finalUrl } = await safeFetch(target, { signal: controller.signal, headers: { 'User-Agent': UA, Accept: 'text/html' } });
          if (!page.ok) throw httpError(502, `site returned ${page.status}`);
          const type = page.headers.get('content-type') || '';
          if (!type.includes('html')) throw httpError(415, 'page is not html');
          const html = (await page.text()).slice(0, 2 * 1024 * 1024);
          const snap = extractSnapshot(html);
          const title =
            metaTag(html, 'property', 'og:title') ||
            decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim() ||
            null;
          return send(res, 200, { url: finalUrl, title, ...snap });
        } finally {
          clearTimeout(timer);
        }
      }

      if (p === '/api/enrich' && req.method === 'GET') {
        const target = url.searchParams.get('url');
        if (!/^https?:\/\//i.test(target || '')) return send(res, 400, { error: 'need an http(s) url' });
        return send(res, 200, await enrich(target));
      }

      if (p === '/media' && req.method === 'GET') {
        const target = url.searchParams.get('url');
        if (!/^https?:\/\//i.test(target || '')) return send(res, 400, { error: 'need an http(s) url' });
        await proxyMedia(req, res, target, url.searchParams.get('ref'));
        return;
      }

      return send(res, 404, { error: 'unknown endpoint' });
    }

    let rel;
    try {
      rel = decodeURIComponent(p === '/' ? 'index.html' : p.slice(1));
    } catch {
      return send(res, 400, { error: 'malformed path' });
    }
    const abs = path.resolve(ROOT, rel);
    const relFromRoot = path.relative(ROOT, abs);
    const publicFile = PUBLIC_FILES.has(relFromRoot);
    const publicMedia = PUBLIC_DIRS.some((d) => abs !== d && inside(d, abs));
    if (!publicFile && !publicMedia) return send(res, 404, { error: 'not found' });
    return serveStatic(req, res, abs, relFromRoot, url.searchParams.get('inline') === '1');
  } catch (err) {
    console.error(`${req.method} ${req.url} ->`, err.message);
    return send(res, err.status || 500, { error: err.message });
  }
});

server.on('clientError', (err, socket) => socket.destroy());

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — the gallery is probably already running.`);
    console.error(`    • Just open http://${HOST}:${PORT} in your browser instead, or`);
    console.error(`    • stop the other window (Ctrl+C), or`);
    console.error(`    • run this one elsewhere:  set PORT=8080 && node server.js\n`);
  } else if (err.code === 'EACCES') {
    console.error(`\n  Permission denied binding ${HOST}:${PORT}. Try another port: set PORT=8080 && node server.js\n`);
  } else {
    console.error('\n  Server failed to start:', err.message, '\n');
  }
  process.exit(1);
});

// A failing remote host must never take the gallery down, but a startup failure must.
let listening = false;
server.on('listening', () => (listening = true));
process.on('unhandledRejection', (err) => console.error('ignored async error:', err?.message || err));
process.on('uncaughtException', (err) => {
  if (!listening) {
    console.error('  server failed to start:', err.message);
    process.exit(1);
  }
  console.error('ignored fatal error:', err?.message || err);
});

let appVersion = '0.0.0';
try {
  appVersion = require('./package.json').version;
} catch {
  /* minimal deployments and single-file binaries may not ship package.json */
}

(async () => {
  store = await createStore({ root: ROOT, appVersion });
  schema = store.schema;
  await store.load(); // migrate legacy libraries at startup, before serving
  server.listen(PORT, HOST, () => {
    const port = server.address().port;
    console.log(`  reelkeep  ->  http://${HOST}:${port}`);
    console.log(`  library file   ->  ${store.LIB_FILE}`);
    console.log(`  stop with Ctrl+C`);
  });
})();
