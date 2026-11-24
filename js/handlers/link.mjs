/* ReelKeep generic link handler — the fallback for any URL that is not a
   known media type. Article enrichment (description, reader snapshot) lands
   in Phase 2; the envelope is already universal. */

import { newId, nowIso } from '../schema.mjs';
import { hostOf, parseUrl } from '../util.mjs';

export const linkHandler = {
  type: 'link',
  icon: '#i-link',
  label: (item) => item.source?.name || hostOf(item.url) || 'Link',
  sourceKey: () => 'link',
  detect(input) {
    if (input.url && parseUrl(input.url)) return 0.1;
    return 0;
  },
  async create(input) {
    const u = parseUrl(input.url);
    const now = nowIso();
    return {
      id: newId('i'),
      type: 'link',
      title: input.title || u?.hostname || 'Link',
      url: u?.href || input.url || '',
      source: { name: input.site || u?.hostname.replace(/^www\./, '') || '', domain: u?.hostname.replace(/^www\./, '') || '' },
      folderId: input.folderId || null,
      tags: input.tags || [],
      notes: input.notes || '',
      cover: input.cover || { kind: 'none', path: '', origin: 'auto' },
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      openCount: 0,
      pinned: false,
      data: { description: input.description || '' },
    };
  },
  searchText: (item) => item.data?.description || '',
};
