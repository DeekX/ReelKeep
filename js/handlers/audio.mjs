/* ReelKeep audio handler — URL or upload, built-in player with speed control
   and remembered position. Cover: page image when known, else the type icon. */

import { newId, nowIso } from '../schema.mjs';
import { hostOf, parseUrl, fmtTime } from '../util.mjs';

const AUDIO_EXT = /\.(mp3|m4a|wav|ogg|oga|flac|aac|opus)(\?|#|$)/i;

export const audioHandler = {
  type: 'audio',
  icon: '#i-audio',
  plays: true,
  label: (item, t) => t('type.audio'),
  sourceKey: () => 'audio',
  detect(input) {
    if (input.file) return /^audio\//.test(input.file.type) || AUDIO_EXT.test(input.file.name) ? 0.95 : 0;
    if (input.url && AUDIO_EXT.test(input.url)) return 0.9;
    return 0;
  },
  async create(input) {
    const now = nowIso();
    const u = input.url ? parseUrl(input.url) : null;
    const stored = input.path || '';
    return {
      id: newId('i'),
      type: 'audio',
      title: input.title || u?.hostname || 'Audio',
      url: input.url || (stored ? '/' + stored : ''),
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
      data: {
        filePath: stored,
        fileUrl: input.url && !stored ? input.url : '',
        progress: null,
        duration: input.duration ?? null,
        artist: input.artist || '',
        album: input.album || '',
      },
    };
  },
  searchText: (item) => [item.data?.artist, item.data?.album].filter(Boolean).join(' '),
  stamp: (item) => (item.data?.duration ? fmtTime(item.data.duration) : ''),
  editExtra(container, item, ctx) {
    const d = item.data || {};
    container.innerHTML = `
      <div class="row">
        <label class="field"><span>${ctx.esc(ctx.t('audio.artist'))}</span><input id="edArtist" type="text" value="${ctx.esc(d.artist || '')}" /></label>
        <label class="field"><span>${ctx.esc(ctx.t('audio.album'))}</span><input id="edAlbum" type="text" value="${ctx.esc(d.album || '')}" /></label>
      </div>`;
  },
  collectEdit(container) {
    return { data: { artist: container.querySelector('#edArtist')?.value.trim() || '', album: container.querySelector('#edAlbum')?.value.trim() || '' } };
  },
  openViewer(item, ctx) {
    const d = item.data || {};
    const src = d.filePath ? ctx.storage.getFileUrl(d.filePath) : d.fileUrl || item.url;
    const wrap = document.createElement('div');
    wrap.className = 'audioview';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src =
      ctx.backend === 'remote' && d.fileUrl && !d.filePath && /^https?:/i.test(d.fileUrl)
        ? `/media?url=${encodeURIComponent(d.fileUrl)}`
        : src;
    const bar = document.createElement('div');
    bar.className = 'viewer-bar';
    const speedLabel = document.createElement('span');
    speedLabel.className = 'viewer-label';
    speedLabel.textContent = ctx.t('audio.speed');
    const speed = document.createElement('select');
    for (const v of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = `${v}×`;
      if (v === 1) o.selected = true;
      speed.append(o);
    }
    speed.onchange = () => (audio.playbackRate = Number(speed.value));
    bar.append(speedLabel, speed);
    wrap.append(audio, bar);
    ctx.container.append(wrap);
    let lastSave = 0;
    const onTime = () => {
      if (Math.abs(audio.currentTime - lastSave) >= 5) {
        lastSave = audio.currentTime;
        ctx.patch(item.id, { data: { progress: Math.floor(audio.currentTime) } }, false);
      }
    };
    const onMeta = () => {
      if (isFinite(audio.duration) && !d.duration) ctx.patch(item.id, { data: { duration: Math.round(audio.duration) } }, false);
      if (ctx.resume > 5) audio.currentTime = ctx.resume;
    };
    const onEnd = () => ctx.patch(item.id, { data: { progress: null } }, false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    return () => {
      if (audio.currentTime > 5) ctx.patch(item.id, { data: { progress: Math.floor(audio.currentTime) } }, false);
      audio.pause();
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeAttribute('src');
      audio.load();
    };
  },
};
