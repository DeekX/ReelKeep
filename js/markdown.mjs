/* ReelKeep minimal Markdown — headings, emphasis, lists, links, code,
   blockquote. Output is built as DOM nodes: sanitized by construction.
   Link schemes allowlisted to http/https/mailto. */

const SAFE_SCHEME = /^(https?:|mailto:)/i;

function inlineNodes(text, doc) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(doc.createTextNode(text.slice(last, m.index)));
    if (m[2] != null) {
      const el = doc.createElement('strong');
      el.textContent = m[2];
      out.push(el);
    } else if (m[3] != null) {
      const el = doc.createElement('em');
      el.textContent = m[3];
      out.push(el);
    } else if (m[4] != null) {
      const el = doc.createElement('code');
      el.textContent = m[4];
      out.push(el);
    } else {
      const href = m[6];
      if (SAFE_SCHEME.test(href)) {
        const a = doc.createElement('a');
        a.href = href;
        a.textContent = m[5];
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        out.push(a);
      } else {
        out.push(doc.createTextNode(m[5]));
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(doc.createTextNode(text.slice(last)));
  return out;
}

/** Render Markdown source into a container element (replaces children). */
export function renderMarkdown(source, container, doc = document) {
  container.textContent = '';
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  let list = null; // {el, ordered}
  let para = [];
  let code = null; // fenced block accumulator
  let quote = null;

  const flushPara = () => {
    if (!para.length) return;
    const p = doc.createElement('p');
    inlineNodes(para.join(' '), doc).forEach((n) => p.append(n));
    container.append(p);
    para = [];
  };
  const flushList = () => {
    if (list) container.append(list.el);
    list = null;
  };
  const flushQuote = () => {
    if (quote) container.append(quote);
    quote = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (code) {
      if (/^```/.test(line)) {
        const pre = doc.createElement('pre');
        const c = doc.createElement('code');
        c.textContent = code.join('\n');
        pre.append(c);
        container.append(pre);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      const el = doc.createElement(`h${h[1].length}`);
      inlineNodes(h[2], doc).forEach((n) => el.append(n));
      container.append(el);
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushList();
      if (!quote) quote = doc.createElement('blockquote');
      const p = doc.createElement('p');
      inlineNodes(q[1], doc).forEach((n) => p.append(n));
      quote.append(p);
      continue;
    }
    flushQuote();
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { el: doc.createElement(ordered ? 'ol' : 'ul'), ordered };
      }
      const li = doc.createElement('li');
      inlineNodes((ul || ol)[1], doc).forEach((n) => li.append(n));
      list.el.append(li);
      continue;
    }
    flushList();
    if (!line.trim()) {
      flushPara();
      continue;
    }
    para.push(line.trim());
  }
  if (code) {
    const pre = doc.createElement('pre');
    const c = doc.createElement('code');
    c.textContent = code.join('\n');
    pre.append(c);
    container.append(pre);
  }
  flushAll();
  return container;
}
