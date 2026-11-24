/* ReelKeep views — grid/list rendering, filter bars, empty states.
   Reads the library core; never touches storage or the network. */

import { $, $$, esc, fmtTime, hostOf, assetUrl } from './util.mjs';
import { relDate } from './ui.mjs';
import { state, visibleItems, byId, getStorage, patch } from './library.mjs';
import { labelOf, sourceKeyOf, stampOf, iconOf, playsOf, badgeOf } from './handlers/registry.mjs';
import { PROVIDERS } from './providers.mjs';

export function thumbnailFor(item) {
  const cover = item.cover;
  if (cover && cover.kind !== 'none' && cover.path) {
    return cover.kind === 'file' ? getStorage()?.getFileUrl(cover.path) || assetUrl(cover.path) : cover.path;
  }
  const d = item.data || {};
  return PROVIDERS[d.provider]?.thumb?.({ videoId: d.videoId }) || null;
}

export function highlight(text, tokens) {
  const safe = esc(text || '');
  if (!tokens.length) return safe;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

export function cardHtml(v, tokens) {
  const d = v.data || {};
  const thumb = thumbnailFor(v);
  const label = esc(labelOf(v));
  const badge = badgeOf(v);
  const stamp = stampOf(v);
  const tags = (v.tags || []).slice(0, 3).map((tag) => `<span class="t">#${esc(tag)}</span>`).join('');
  const folder = state.folders.find((f) => f.id === v.folderId);
  const fold = folder && state.folder === 'all' ? `<span class="fold"><svg><use href="#i-folder" /></svg>${esc(folder.name)}</span>` : '';
  const sel = state.selecting
    ? `<label class="card-select"><input type="checkbox" data-act="select" ${state.selected.has(v.id) ? 'checked' : ''} aria-label="${esc(t('card.select', { title: v.title }))}"></label>`
    : '';
  return `<article class="card${state.selected.has(v.id) ? ' selected' : ''}" data-id="${v.id}" tabindex="0" draggable="true" aria-label="${esc(v.title)}">
    <div class="thumb">
      ${sel}
      <div class="ph"><svg><use href="${iconOf(v)}" /></svg></div>
      ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" draggable="false" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <span class="badge">${badge}${label}</span>
      ${stamp ? `<span class="stamp">${esc(stamp)}</span>` : ''}
      ${playsOf(v) ? '<div class="thumb-play"><span><svg><use href="#i-play" /></svg></span></div>' : ''}
      <div class="card-actions">
        <button class="icon-btn" data-act="edit" title="${esc(t('lb.edit'))}"><svg><use href="#i-edit" /></svg></button>
        <button class="icon-btn" data-act="del" title="${esc(t('delete'))}"><svg><use href="#i-trash" /></svg></button>
      </div>
    </div>
    <div class="card-body">
      <h3 class="card-title" data-act="rename" title="${esc(t('lb.rename'))}">${highlight(v.title || t('card.untitled'), tokens)}</h3>
      ${v.notes ? `<p class="card-notes">${esc(v.notes)}</p>` : ''}
      <div class="card-sub">${fold}${tags}<span class="host">${esc(hostOf(v.url) || t('card.local'))}</span>${d.startAt ? `<span>· ${esc(t('card.starts', { t: fmtTime(d.startAt) }))}</span>` : ''}<span class="when">${esc(relDate(v.createdAt))}</span></div>
    </div>
  </article>`;
}

export function renderTagbar() {
  const counts = new Map();
  state.items.forEach((v) => (v.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1)));
  const bar = $('#tagbar');
  bar.innerHTML =
    `<span class="tagbar-label">${esc(t('tags.label'))}</span>` +
    `<button class="chip${state.tags.size ? '' : ' on'}" data-tagreset="1">${esc(t('tags.all'))}</button>` +
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, n]) => `<button class="chip${state.tags.has(tag) ? ' on' : ''}" data-tag="${esc(tag)}">#${esc(tag)}<small>${n}</small></button>`)
      .join('');
}

export function renderProviders() {
  const sel = $('#providerSel');
  const keep = state.provider;
  const seen = new Map();
  state.items.forEach((v) => seen.set(sourceKeyOf(v), labelOf(v)));
  sel.innerHTML =
    `<option value="">${esc(t('source.all'))}</option>` +
    [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([k, label]) => `<option value="${esc(k)}"${k === keep ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
}

export function renderTypes() {
  const sel = $('#typeSel');
  const keep = state.type;
  const seen = new Map();
  state.items.forEach((v) => seen.set(v.type, (seen.get(v.type) || 0) + 1));
  sel.innerHTML =
    `<option value="">${esc(t('filter.type.all'))}</option>` +
    [...seen.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, n]) => `<option value="${esc(k)}"${k === keep ? ' selected' : ''}>${esc(t('type.' + k))} · ${n}</option>`)
      .join('');
}

export const groupKey = (v) => {
  const key = sourceKeyOf(v);
  return key === 'page' || key === 'custom' ? hostOf(v.url) || key : key;
};

export function render() {
  const tokens = state.tokens;
  const list = visibleItems();
  // chunked rendering: large libraries stay responsive, "Load more" appends
  const shown = list.slice(0, state.limit);
  let html;
  if (state.group) {
    const groups = new Map();
    list.forEach((v) => {
      const k = groupKey(v);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    });
    let budget = state.limit;
    html = [...groups.values()]
      .sort((a, b) => labelOf(a[0]).localeCompare(labelOf(b[0])))
      .map((vs) => {
        const take = Math.min(vs.length, budget);
        budget -= take;
        if (take <= 0) return '';
        return (
          `<div class="group-head"><svg><use href="#i-group" /></svg><h2>${esc(labelOf(vs[0]))}</h2><span>${vs.length}</span></div>` +
          vs.slice(0, take).map((v) => cardHtml(v, tokens)).join('')
        );
      })
      .join('');
  } else {
    html = shown.map((v) => cardHtml(v, tokens)).join('');
  }
  $('#grid').innerHTML = html;
  const row = $('#pageRow');
  row.hidden = list.length <= state.limit;
  if (!row.hidden) $('#pageShowing').textContent = t('page.showing', { a: shown.length, b: list.length });
  $('#headCount').textContent = t(state.items.length === 1 ? 'count.one' : 'count.other', { n: state.items.length });
  $('#grid').classList.toggle('selecting', state.selecting);
  // an empty flex:1 grid would eat the free space and push #empty to the footer
  $('#grid').hidden = list.length === 0;
  $('#count').textContent =
    t(state.items.length === 1 ? 'count.one' : 'count.other', { n: state.items.length }) +
    (tokens.length || state.tags.size || state.provider || state.type || state.folder !== 'all' ? ' ' + t('count.shown', { n: list.length }) : '');
  const empty = $('#empty');
  empty.hidden = list.length > 0;
  if (!state.items.length) {
    $('#emptyTitle').textContent = t('empty.title');
    $('#emptyText').textContent = t('empty.text');
  } else {
    $('#emptyTitle').textContent = t('nomatch.title');
    $('#emptyText').textContent = t('nomatch.text');
  }
  renderTagbar();
  renderProviders();
  renderTypes();
  renderFolderbar();
  renderFolderActions();
  renderSelectbar();
}

export function renderFolderbar() {
  const counts = new Map();
  let unfiled = 0;
  state.items.forEach((v) => {
    if (v.folderId) counts.set(v.folderId, (counts.get(v.folderId) || 0) + 1);
    else unfiled++;
  });
  const chip = (key, label, n, extra = '') =>
    `<button class="chip${state.folder === key ? ' on' : ''}" data-folder="${esc(key)}" ${extra}>${label}<small>${n}</small></button>`;
  $('#folderbar').innerHTML =
    chip('all', t('folder.all'), state.items.length) +
    chip('unfiled', t('folder.unfiled'), unfiled) +
    state.folders
      .map((f) => chip(f.id, `<svg class="fi"><use href="#i-folder" /></svg>${esc(f.name)}`, counts.get(f.id) || 0, `title="${esc(t('folder.chip.title'))}"`))
      .join('') +
    `<button class="chip newfolder" data-newfolder="1" title="${esc(t('folder.new.title'))}"><svg class="fi"><use href="#i-plus" /></svg>${esc(t('folder.new'))}</button>`;
}

export function renderFolderActions() {
  const f = state.folders.find((x) => x.id === state.folder);
  const bar = $('#folderActions');
  bar.hidden = !f;
  if (!f) return;
  const n = state.items.filter((v) => v.folderId === f.id).length;
  $('#faName').textContent = f.name;
  $('#faCount').textContent = t(n === 1 ? 'count.one' : 'count.other', { n });
  $('#faEmpty').disabled = !n;
}

export function renderSelectbar() {
  const bar = $('#selectbar');
  bar.hidden = !state.selecting;
  $('#selCount').textContent = t('sel.count', { n: state.selected.size });
  $('#selMove').disabled = !state.selected.size;
  $('#selectBtn').classList.toggle('on', state.selecting);
  $('#selectBtn').setAttribute('aria-pressed', String(state.selecting));
}

export function toggleSelect(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  render();
}

export function setSelecting(on) {
  state.selecting = on;
  if (!on) state.selected.clear();
  render();
}

export function startRename(v, el) {
  if (!v || !el) return;
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = v.title || '';
  el.replaceWith(input);
  input.focus();
  input.select();
  let save = true;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      save = false;
      input.blur();
    }
  };
  input.onblur = () => {
    const next = input.value.trim();
    if (save && next && next !== v.title) patch(v.id, { title: next });
    else render();
  };
}
