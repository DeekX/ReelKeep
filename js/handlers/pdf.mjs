/* ReelKeep PDF handler — browser's built-in viewer in a sandboxed frame.
   Nothing from the file ever executes in the app origin. */

import { newId, nowIso } from '../schema.mjs';
import { parseUrl } from '../util.mjs';

export const pdfHandler = {
  type: 'pdf',
  icon: '#i-pdf',
  covers: false,
  label: (item, t) => t('type.pdf'),
  sourceKey: () => 'pdf',
  detect(input) {
    if (input.file) return input.file.type === 'application/pdf' || /\.pdf$/i.test(input.file.name) ? 0.95 : 0;
    if (input.url && /\.pdf(\?|#|$)/i.test(input.url)) return 0.9;
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const u = input.url ? parseUrl(input.url) : null;
    const stored = input.path || '';
    return {
      id: newId('i'),
      type: 'pdf',
      title: input.title || u?.hostname || 'PDF',
      url: input.url || (stored ? '/' + stored : ''),
      source: { name: input.site || u?.hostname.replace(/^www\./, '') || '', domain: u?.hostname.replace(/^www\./, '') || '' },
      folderId: input.folderId || null,
      tags: input.tags || [],
      notes: input.notes || '',
      cover: { kind: 'none', path: '', origin: 'auto' },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
      pinned: false,
      data: { filePath: stored, fileUrl: input.url && !stored ? input.url : '', pages: input.pages ?? null },
    };
  },
  searchText: () => '',
  stamp: (item, t) => (item.data?.pages ? t('pdf.pages', { n: item.data.pages }) : ''),
  openViewer(item, ctx) {
    const d = item.data || {};
    const frame = document.createElement('iframe');
    frame.className = 'native-frame';
    frame.title = item.title || 'PDF';
    // narrowest sandbox that still lets the browser's PDF viewer work
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-downloads');
    frame.src = d.filePath ? ctx.storage.getFileUrl(d.filePath) + '?inline=1' : d.fileUrl || item.url;
    ctx.container.append(frame);
    return () => {
      frame.src = 'about:blank';
    };
  },
};
