/* ReelKeep reader snapshot — dependency-free main-content extraction.
   Output is TEXT blocks only (tag + text), rendered by DOM construction in the
   app: sanitized by construction, no HTML from the page ever reaches the DOM. */
'use strict';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
function decodeEntities(str = '') {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(#?[a-z0-9]+);/gi, (m, key) => ENTITIES[key.toLowerCase()] ?? m);
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

/** Extract { title, blocks, readingTimeMin } from page HTML. */
function extractSnapshot(html, { maxBlocks = 400, maxChars = 40000 } = {}) {
  let scope = String(html || '');
  scope = scope.replace(/<(script|style|noscript|template|svg|iframe|form|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  scope = scope.replace(/<!--[\s\S]*?-->/g, ' ');
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(scope);
  if (main) scope = main[2];
  else {
    const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(scope);
    if (body) scope = body[1];
  }

  const blocks = [];
  let chars = 0;
  const re = /<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(scope)) && blocks.length < maxBlocks && chars < maxChars) {
    const text = clean(m[2].replace(/<[^>]+>/g, ' '));
    if (!text || text.length < 2) continue;
    const tag = m[1].toLowerCase();
    // skip navigation-ish single-word list items and repeated chrome
    if (tag === 'li' && text.length < 24 && !/[.!?]$/.test(text)) continue;
    blocks.push({ tag, text: text.slice(0, 2000) });
    chars += text.length;
  }
  const words = blocks.reduce((n, b) => n + b.text.split(/\s+/).length, 0);
  return {
    blocks,
    readingTimeMin: Math.max(1, Math.round(words / 220)),
  };
}

module.exports = { extractSnapshot, decodeEntities };
