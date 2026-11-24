/* ReelKeep exporters — escape lock-in: CSV and Netscape bookmarks HTML,
   alongside the full-fidelity JSON bundle. Pure, node-testable. */

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(items) {
  const head = ['id', 'type', 'title', 'url', 'folder', 'tags', 'notes', 'createdAt', 'lastOpenedAt'];
  const rows = [head.join(',')];
  for (const it of items) {
    rows.push(
      [
        it.id,
        it.type,
        it.title,
        it.url,
        it.folderId || '',
        (it.tags || []).join(';'),
        it.notes,
        it.createdAt,
        it.lastOpenedAt || '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toBookmarksHtml(items, folders = []) {
  const names = new Map(folders.map((f) => [f.id, f.name]));
  const groups = new Map();
  for (const it of items) {
    const key = it.folderId ? names.get(it.folderId) || 'Folder' : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const link = (it) => {
    const epoch = Math.floor(Date.parse(it.createdAt || Date.now()) / 1000);
    const tags = (it.tags || []).join(',');
    return `        <DT><A HREF="${escHtml(it.url)}" ADD_DATE="${epoch}"${tags ? ` TAGS="${escHtml(tags)}"` : ''}>${escHtml(it.title)}</A>`;
  };
  let body = '';
  for (const [name, list] of groups) {
    if (name) {
      body += `    <DT><H3>${escHtml(name)}</H3>\n    <DL><p>\n${list.map(link).join('\n')}\n    </DL><p>\n`;
    } else {
      body += list.map(link).join('\n') + '\n';
    }
  }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file.\n     It will be read and overwritten by the bookmark exporter. -->\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>ReelKeep exports</TITLE>\n<H1>ReelKeep exports</H1>\n<DL><p>\n${body}</DL><p>\n`;
}
