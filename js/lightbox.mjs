/* ReelKeep lightbox — the unified player/viewer host. */

import { $, $$, esc, fmtTime, hostOf } from './util.mjs';
import { toast } from './ui.mjs';
import { state, byId, patch, visibleItems } from './library.mjs';
import { labelOf } from './handlers/registry.mjs';
import { frameSrc } from './handlers/video.mjs';
import { render } from './views.mjs';
import { openEdit } from './dialogs.mjs';
import { openThumbPicker } from './thumbpicker.mjs';

const lb = $('#lightbox');

export function openPlayer(id) {
  const v = byId(id);
  if (!v) return;
  state.current = v;
  state.lastTime = 0;
  $('#lbFrame').src = frameSrc(v, state.backend);
  $('#lbTitle').textContent = v.title || t('card.untitled');
  paintLbMeta(v);
  paintLbDetails(v);
  $('#lbRemember').checked = false;
  $('#lbRemember').closest('.switch').hidden = v.data?.kind !== 'file';
  $$('.lb-nav').forEach((b) => (b.style.visibility = ''));
  positionNav();
  lb.showModal();
  patch(v.id, { lastOpenedAt: new Date().toISOString() }, false);
}

export function paintLbMeta(v) {
  const d = v.data || {};
  $('#lbHint').hidden = d.kind !== 'page';
  if (d.kind === 'page') $('#lbHint').textContent = t('lb.hint');
  const bits = [];
  if (v.url) bits.push(`<span class="m">${esc(hostOf(v.url))}</span>`);
  if (d.duration) bits.push(`<span class="m">${fmtTime(d.duration)}</span>`);
  if (d.startAt) bits.push(`<span class="m">${esc(t('lb.starts', { t: fmtTime(d.startAt) }))}</span>`);
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
  const remember = $('#lbRemember').checked && state.lastTime > 1 && state.current?.data?.kind === 'file';
  if (remember && state.current) patch(state.current.id, { startAt: Math.floor(state.lastTime) }, false);
  lb.close();
  $('#lbFrame').src = 'about:blank';
  lb.classList.remove('fit');
  state.current = null;
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.from !== 'vg-player') return;
  if (d.type === 'time') state.lastTime = d.t;
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
