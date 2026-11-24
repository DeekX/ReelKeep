/* ReelKeep automatic enrichment — opening-frame covers for readable files and
   lazy duration backfill for embeds. Honest by design: when a site exposes no
   duration, the stamp stays absent. */

import { clamp, drawFrame, seekPromise } from './util.mjs';
import { state, byId, patch, getStorage, enrichUrl } from './library.mjs';
import { playableSrc } from './handlers/video.mjs';
import { render } from './views.mjs';

/** capture a sensible first thumbnail for uploaded / direct video files */
export async function autoThumbnail(v) {
  const src = playableSrc(v, state.backend);
  if (!src || (v.cover && v.cover.kind !== 'none')) return;
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
    const time = clamp(dur * 0.08, 1, dur ? Math.max(1, dur - 2) : 60);
    await seekPromise(video, time);
    if (!video.videoWidth) throw new Error('no frame');
    const canvas = document.createElement('canvas');
    const saved = await getStorage().putFile('thumbnails/', drawFrame(video, canvas, 0.8));
    patch(v.id, { thumbnail: saved, thumbSource: 'frame', thumbTime: Math.round(time), duration: Math.round(dur) }, false);
    render();
  } catch {
    /* leave the placeholder — the user can pick one manually */
  }
}

/* embeds cannot report duration from inside a cross-origin iframe; backfill it
   from the page metadata (itemprop/og/JSON-LD duration) for a few at a time */
export async function autoDuration(v) {
  if (state.backend !== 'remote' || v.data?.duration || v.data?.kind === 'file') return;
  try {
    const meta = await enrichUrl(v.url);
    const cur = byId(v.id);
    if (meta?.duration && cur && !cur.data?.duration) {
      patch(v.id, { duration: meta.duration }, false);
      render();
    }
  } catch {
    /* site exposes no duration — the stamp stays absent, honestly */
  }
}

/* fill missing embed durations across the WHOLE library, two at a time, so large
   libraries don't need one reload per four videos; each patch persists as it lands */
export function startDurationBackfill() {
  if (state.backend !== 'remote') return;
  const queue = state.items.filter((v) => v.type === 'video' && !v.data?.duration && v.data?.kind !== 'file');
  let i = 0;
  const worker = async () => {
    while (i < queue.length) await autoDuration(queue[i++]);
  };
  setTimeout(worker, 800);
  setTimeout(worker, 1400);
}
