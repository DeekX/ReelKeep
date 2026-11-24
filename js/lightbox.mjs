/* ReelKeep lightbox — the unified viewer host. Video plays through the iframe
   stage; every other type renders a native viewer from its handler. */

import { $, $$, esc, fmtTime, hostOf } from './util.mjs';
import { toast } from './ui.mjs';
import { state, byId, patch, visibleItems, getStorage, snapshotUrl } from './library.mjs';
import { getHandler, labelOf, coversOf } from './handlers/registry.mjs';
import { frameSrc } from './handlers/video.mjs';
import { render } from './views.mjs';
import { openEdit } from './dialogs.mjs';
import { openThumbPicker } from './thumbpicker.mjs';

const lb = $('#lightbox');
let viewerCleanup = null;
let lastProgressSave = 0;

function viewerCtx(item, resume) {
  return {
    container: $('#lbNative'),
    storage: getStorage(),
    backend: state.backend,
    resume: resume || 0,
    patch,
    t,
    toast,
    openEdit,
    snapshot: snapshotUrl,
  };
}

function closeViewer() {
  if (viewerCleanup) {
    try {
      viewerCleanup();
    } catch {
      /* viewer already torn down */
    }
    viewerCleanup = null;
  }
  const native = $('#lbNative');
  native.textContent = '';
  native.hidden = true;
}

export function openPlayer(id, opts = {}) {
  const v = byId(id);
  if (!v) return;
  closeViewer();
  state.current = v;
  state.lastTime = 0;
  lastProgressSave = 0;
  const handler = getHandler(v.type);
  const frameWrap = $('.lb-frame-wrap');
  if (handler?.frame) {
    frameWrap.hidden = false;
    $('#lbFrame').src = frameSrc(v, state.backend, opts.resume || v.data?.startAt || 0);
  } else {
    frameWrap.hidden = true;
    $('#lbFrame').src = 'about:blank';
    $('#lbNative').hidden = false;
    viewerCleanup = handler?.openViewer?.(v, viewerCtx(v, opts.resume)) || null;
  }
  $('#lbTitle').textContent = v.title || t('card.untitled');
  paintLbMeta(v);
  paintLbDetails(v);
  $('#lbRemember').checked = false;
  $('#lbRemember').closest('.switch').hidden = !(v.type === 'video' && v.data?.kind === 'file');
  $('[data-lb="thumb"]').hidden = !coversOf(v);
  // offer resume, never force it: explicit startAt stays untouched
  const prog = v.data?.progress;
  const resumable = (v.type === 'video' || v.type === 'audio') && prog > 5 && !opts.resume;
  $('#lbResume').hidden = !resumable;
  if (resumable) {
    $('#lbResume').textContent = t('lb.resume', { t: fmtTime(prog) });
    $('#lbResume').onclick = () => openPlayer(v.id, { resume: prog });
  }
  $$('.lb-nav').forEach((b) => (b.style.visibility = ''));
  positionNav();
  lb.showModal();
  patch(v.id, { lastOpenedAt: new Date().toISOString() }, false);
}

export function paintLbMeta(v) {
  const d = v.data || {};
  $('#lbHint').hidden = !(v.type === 'video' && d.kind === 'page');
  if (v.type === 'video' && d.kind === 'page') $('#lbHint').textContent = t('lb.hint');
  const bits = [];
  if (v.type !== 'video') bits.push(`<span class="m">${esc(t('type.' + v.type))}</span>`);
  if (v.url && /^https?:/i.test(v.url)) bits.push(`<span class="m">${esc(hostOf(v.url))}</span>`);
  if (d.duration) bits.push(`<span class="m">${fmtTime(d.duration)}</span>`);
  if (v.type === 'video' && d.startAt) bits.push(`<span class="m">${esc(t('lb.starts', { t: fmtTime(d.startAt) }))}</span>`);
  bits.push(...(v.tags || []).map((tag) => `<span class="t">#${esc(tag)}</span>`));
  $('#lbMeta').innerHTML = bits.join('');
}

export function paintLbDetails(v) {
  const folder = state.folders.find((f) => f.id === v.folderId);
  $('#lbSub').textContent = `${labelOf(v)} / ${folder ? folder.name : t('folder.unfiled')}`;
  const list = visibleItems();
  const i = list.findIndex((x) => x.id === v.id);
  $('#lbPos').textContent = i === -1 ? '' : t('lb.position', { i: i + 1, n: list.length });
  const notes = $('#lbNotes');
  notes.hidden = !v.notes;
  if (v.notes) notes.innerHTML = `<b>${esc(v.notes)}</b>`;
}

export function positionNav() {
  const list = visibleItems();
  const i = list.findIndex((v) => v.id === state.current?.id);
  if (i === -1) return;
  $('.lb-nav.prev').style.visibility = i > 0 ? '' : 'hidden';
  $('.lb-nav.next').style.visibility = i < list.length - 1 ? '' : 'hidden';
}

export function stepVideo(dir) {
  const list = visibleItems();
  const i = list.findIndex((v) => v.id === state.current?.id);
  const next = list[i + dir];
  if (next) openPlayer(next.id);
}

export function closePlayer() {
  const v = state.current;
  const remember = $('#lbRemember').checked && state.lastTime > 1 && v?.type === 'video' && v.data?.kind === 'file';
  if (remember && v) patch(v.id, { startAt: Math.floor(state.lastTime) }, false);
  if (v?.type === 'video' && state.lastTime > 5) patch(v.id, { progress: Math.floor(state.lastTime) }, false);
  closeViewer();
  lb.close();
  $('#lbFrame').src = 'about:blank';
  lb.classList.remove('fit');
  state.current = null;
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return; // playback telemetry: own origin only
  const d = e.data;
  if (!d || d.from !== 'vg-player') return;
  if (d.type === 'time') {
    state.lastTime = d.t;
    // remember position as playback advances, not only on close
    if (state.current?.type === 'video' && Math.abs(d.t - lastProgressSave) >= 15) {
      lastProgressSave = d.t;
      patch(state.current.id, { progress: Math.floor(d.t) }, false);
    }
  }
  if (d.type === 'meta' && d.duration && state.current && !state.current.data?.duration) {
    patch(state.current.id, { duration: Math.round(d.duration) }, false);
  }
});

lb.addEventListener('click', (e) => {
  if (e.target === lb) closePlayer(); // click on the backdrop area
});

lb.addEventListener('cancel', (e) => {
  e.preventDefault();
  closePlayer();
});

$$('[data-lb]').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const act = btn.dataset.lb;
    if (act === 'close') closePlayer();
    if (act === 'prev') stepVideo(-1);
    if (act === 'next') stepVideo(1);
    if (act === 'open' && state.current?.url) window.open(state.current.url, '_blank', 'noopener');
    if (act === 'edit' && state.current) openEdit(state.current.id);
    if (act === 'thumb' && state.current) openThumbPicker(state.current.id);
    if (act === 'fit') {
      lb.classList.toggle('fit');
      btn.classList.toggle('on');
    }
    if (act === 'full') {
      const stage = $('#lbStage');
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.requestFullscreen?.().catch(() => toast(t('to.fullscreen'), 'err'));
      btn.classList.toggle('on', !!document.fullscreenElement);
    }
  }),
);

lb.addEventListener('dblclick', (e) => {
  const h2 = e.target.closest('#lbTitle');
  const v = state.current;
  if (!h2 || !v) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = v.title || '';
  h2.replaceWith(input);
  input.focus();
  input.select();
  const restore = () => {
    const back = Object.assign(document.createElement('h2'), {
      id: 'lbTitle',
      className: 'lb-title',
      textContent: state.current?.title || t('card.untitled'),
      title: t('lb.rename'),
    });
    if (input.isConnected) input.replaceWith(back);
  };
  input.onkeydown = (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      input.blur();
    }
    if (ev.key === 'Escape') {
      input.value = state.current?.title || '';
      input.blur();
    }
  };
  input.onblur = async () => {
    const next = input.value.trim();
    if (next && next !== v.title) await patch(v.id, { title: next }, false);
    restore();
    render();
  };
});
