/* ReelKeep thumbnail picker — frame capture for readable sources, provider
   stills / uploaded images / image URLs for everything else. */

import { $, $$, esc, fmtTime, parseTime, clamp, drawFrame, seekPromise, fileToDataUrl, hostOf } from './util.mjs';
import { toast } from './ui.mjs';
import { state, byId, patch, getStorage, copyCover } from './library.mjs';
import { PROVIDERS } from './providers.mjs';
import { canPickFrames, playableSrc } from './handlers/video.mjs';
import { render } from './views.mjs';
import { editingItem, paintEditThumb } from './dialogs.mjs';

const thumbDialog = $('#thumbDialog');
let thumbTarget = null; // item whose cover is being edited
let thumbVideoReady = false;

export async function setThumbnail(id, value, source, time = null) {
  if (!value) return;
  const item = byId(id);
  if (item?.type === 'video') {
    patch(id, { thumbnail: value, thumbSource: source, thumbTime: time });
  } else {
    const stored = /^(thumbnails|files)\//.test(value);
    const origin = source === 'frame' ? 'frame' : source === 'upload' ? 'upload' : source === 'url' ? 'url' : 'auto';
    patch(id, { cover: { kind: stored ? 'file' : 'url', path: value, origin } });
  }
  if (editingItem()?.id === id) paintEditThumb();
  toast(source === 'frame' ? t('to.coverframe', { t: fmtTime(time) }) : t('to.cover'), 'ok', 2000);
}

export function resetCover(id) {
  const item = byId(id);
  if (item?.type === 'video') patch(id, { thumbnail: '', thumbSource: 'auto', thumbTime: null });
  else patch(id, { cover: { kind: 'none', path: '', origin: 'auto' } });
}

export async function openThumbPicker(id) {
  const v = byId(id);
  if (!v) return;
  const d = v.data || {};
  thumbTarget = v;
  thumbVideoReady = false;
  const playable = canPickFrames(v, state.backend);
  const frames = PROVIDERS[d.provider]?.frames?.({ videoId: d.videoId });
  $('#tpFileTitle').textContent = v.title || t('card.untitled');
  $('#tpFileName').textContent = d.fileUrl ? d.fileUrl.split('/').pop() : hostOf(v.url);
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
  $('#tpTime').value = d.startAt ? fmtTime(d.startAt) : '';
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
    const src = playableSrc(v, state.backend);
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
    if (dur && !d.duration) patch(v.id, { duration: Math.round(dur) }, false);
    const start = d.startAt || Math.min(2, dur * 0.1) || 0;
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

async function jumpTo(time) {
  const video = $('#tpVideo');
  if (!thumbVideoReady) return;
  const dur = isFinite(video.duration) ? video.duration : 0;
  const target = dur ? clamp(time, 0, Math.max(0, dur - 0.1)) : Math.max(0, time);
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
  const time = Math.round(parseFloat($('#tpRange').value) || 0);
  const alsoStart = $('#tpAlsoStart').checked;
  const saved = await getStorage().putFile('thumbnails/', drawFrame($('#tpVideo'), $('#tpCanvas')));
  await setThumbnail(thumbTarget.id, saved, 'frame', time);
  if (alsoStart) patch(thumbTarget.id, { startAt: time }, false);
  thumbDialog.close();
});

$('#tpFrames').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-frame]');
  if (!btn) return;
  $$('#tpFrames .frame-opt').forEach((b) => b.classList.toggle('on', b === btn));
  const f = PROVIDERS[thumbTarget.data.provider].frames({ videoId: thumbTarget.data.videoId })[+btn.dataset.frame];
  const saved = await copyCover(f.url, thumbTarget.url);
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
  resetCover(thumbTarget.id);
  thumbDialog.close();
});

$('#tpUpload').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const id = thumbTarget?.id || editingItem()?.id;
  if (!id) return;
  const saved = await getStorage().putFile('thumbnails/', await fileToDataUrl(file));
  await setThumbnail(id, saved, 'upload');
  if (thumbDialog.open) thumbDialog.close();
});

thumbDialog.addEventListener('close', () => {
  const video = $('#tpVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();
  thumbVideoReady = false;
});

thumbDialog.addEventListener('click', (e) => {
  if (e.target === thumbDialog) thumbDialog.close();
});

export const isPickerReady = () => thumbVideoReady;

export { thumbDialog };
