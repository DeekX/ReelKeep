/* ReelKeep dialogs — add item, edit details, move to folder.
   All persistence goes through the library core. */

import { $, $$, esc, assetUrl, hostOf, parseUrl, parseTime, fmtTime, debounce } from './util.mjs';
import { toast, confirmBox } from './ui.mjs';
import {
  state, byId, patch, addItem, removeItem, getStorage, copyCover, enrichUrl, createFolder,
} from './library.mjs';
import { PROVIDERS, detect, cleanTitle, normalizeEmbedUrl, providerLabel } from './providers.mjs';
import { labelOf } from './handlers/registry.mjs';
import { canPickFrames } from './handlers/video.mjs';
import { render, thumbnailFor, setSelecting } from './views.mjs';
import { openThumbPicker, setThumbnail } from './thumbpicker.mjs';
import { moveIds, renameFolderPrompt, deleteFolder } from './folders.mjs';
import { closePlayer } from './lightbox.mjs';
import { autoThumbnail } from './auto.mjs';

/* ================================================================ add */

const addDialog = $('#addDialog');
let draft = null;
let pickedFile = null;

function newDraft() {
  draft = {
    title: '',
    url: '',
    tags: [],
    notes: '',
    startAt: 0,
    kind: 'page',
    provider: 'page',
    videoId: null,
    embedUrl: '',
    fileUrl: '',
    thumbnail: '',
    image: '',
    favicon: '',
    site: '',
    duration: null,
  };
  pickedFile = null;
  $('#addUrl').value = '';
  $('#addEmbed').value = '';
  $('#addFile').value = '';
  $('#pvTitle').value = '';
  $('#pvTags').value = '';
  $('#pvStart').value = '';
  $('#pvNotes').value = '';
  $('#pvUseOg').checked = true;
  $('#pvFolder').innerHTML =
    `<option value="">${esc(t('folder.unfiled'))}</option>` +
    state.folders.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
  $('#pvDetTitle').textContent = '';
  $('#pvDetSub').textContent = '';
  $('#pvStatus').hidden = true;
  $('#dropLabel').textContent = t('upload.choose');
  $('#upProgress').hidden = true;
  $('#addPreview').hidden = true;
  setStatus('');
  updateSave();
}

function setStatus(msg, kind = '') {
  const el = $('#addStatus');
  el.textContent = msg;
  el.className = 'statusline ' + kind;
}

function updateSave() {
  const tab = $('#addDialog .tab.active').dataset.tab;
  const ok = tab === 'link' ? !!draft.url : tab === 'embed' ? !!draft.embedUrl : !!pickedFile;
  $('#addSave').disabled = !ok;
}

function paintPreview() {
  const holder = $('#pvThumb');
  const img = draft.image && $('#pvUseOg').checked ? assetUrl(draft.image) : draft.thumbnail ? assetUrl(draft.thumbnail) : PROVIDERS[draft.provider]?.thumb?.(draft);
  holder.innerHTML = img
    ? `<img src="${esc(assetUrl(img))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ptime">${esc(t('preview.auto'))}</span>`
    : `<span class="placeholder">${esc(t('preview.none'))}</span>`;
  $('#addPreview').hidden = !(draft.url || draft.embedUrl || pickedFile);
  if (!$('#pvDetTitle').textContent) {
    $('#pvDetTitle').textContent = draft.title || hostOf(draft.url) || pickedFile?.name || '';
    $('#pvDetSub').textContent = draft.url || draft.embedUrl ? providerLabel(draft) : '';
  }
}

function setDetected(title, sub, ok) {
  $('#pvDetTitle').textContent = title || '';
  $('#pvDetSub').textContent = sub || '';
  const st = $('#pvStatus');
  st.hidden = ok !== true;
  if (ok === true) $('#pvStatusText').textContent = t('add.preview.ok');
}

const enrich = debounce(async (raw) => {
  const u = parseUrl(raw);
  if (!u) return;
  const found = detect(u.href);
  Object.assign(draft, { url: u.href, provider: found.provider, kind: found.kind, videoId: found.videoId || null });
  paintPreview();
  if (found.kind === 'invalid') return setStatus(t('st.invalid'), 'err');
  if (state.backend !== 'remote') return setStatus(t('st.localenrich'), 'err');
  setStatus(t('st.reading', { host: hostOf(u.href) }), 'busy');
  try {
    const meta = await enrichUrl(u.href);
    if (draft.url !== u.href) return; // superseded by a newer paste
    if (!meta || meta.error) throw new Error(meta?.error || 'no metadata');
    draft.site = meta.siteName || hostOf(meta.pageUrl || u.href);
    draft.favicon = meta.favicon || '';
    if (meta.image) draft.image = meta.image;
    const clean = cleanTitle(meta.title, meta.siteName || hostOf(meta.pageUrl || u.href));
    if (clean && !$('#pvTitle').value.trim()) {
      draft.title = clean;
      $('#pvTitle').value = clean;
    }
    if (meta.duration) draft.duration = meta.duration;
    setDetected(
      clean || draft.title || hostOf(u.href),
      `${providerLabel(draft)}${draft.site ? ' · ' + draft.site : ''}${draft.duration ? ' · ' + fmtTime(draft.duration) : ''}`,
      true,
    );
    if (found.kind === 'page' && meta.mediaUrl) {
      draft.kind = 'file';
      draft.provider = 'file';
      draft.fileUrl = meta.mediaUrl;
      setStatus(t('st.direct'), 'ok');
    } else if (found.kind === 'page') {
      setStatus(t('st.page'), '');
    } else {
      setStatus(t('st.detected', { provider: providerLabel(draft) }), 'ok');
    }
    paintPreview();
  } catch (err) {
    setDetected($('#pvDetTitle').textContent, $('#pvDetSub').textContent, 'err');
    setStatus(t('st.enrichfail', { err: err.message }), 'err');
  }
}, 550);

$('#addUrl').addEventListener('input', (e) => {
  draft.url = e.target.value.trim();
  $('#addPreview').hidden = !draft.url;
  enrich(draft.url);
  updateSave();
});
$('#addUrl').addEventListener('paste', () => setTimeout(() => enrich($('#addUrl').value), 60));
$('#addUrl').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    enrich.now($('#addUrl').value.trim());
  }
});
$('#pvTitle').addEventListener('input', (e) => (draft.title = e.target.value));
$('#pvUseOg').addEventListener('change', paintPreview);

$('#addEmbed').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  const found = /<iframe[^>]*src\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] || (/^<iframe/i.test(raw) ? null : raw);
  const src = normalizeEmbedUrl(found);
  draft.embedUrl = src;
  draft.kind = src ? 'embed' : 'page';
  draft.provider = PROVIDERS.youtube.test(hostOf(src || '')) ? 'youtube' : 'custom';
  if (src) {
    draft.url = draft.url || src;
    setStatus(t('st.embedok', { url: src }), 'ok');
  } else setStatus(t('st.embedhelp'), '');
  paintPreview();
  updateSave();
});

const dropField = $('#dropField');
$('#addFile').addEventListener('change', (e) => {
  pickedFile = e.target.files?.[0] || null;
  if (pickedFile) {
    $('#dropLabel').textContent = `${pickedFile.name} · ${(pickedFile.size / 1048576).toFixed(1)} MB`;
    if (!$('#pvTitle').value) $('#pvTitle').value = pickedFile.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    draft.title = $('#pvTitle').value;
    draft.url = '';
    draft.kind = 'file';
    draft.provider = 'file';
    setStatus(t('st.uploadok'), 'ok');
  }
  paintPreview();
  updateSave();
});
dropField.addEventListener('click', () => $('#addFile').click());

$$('#addDialog .tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    $$('#addDialog .tab').forEach((x) => x.classList.toggle('active', x === tab));
    $$('#addDialog .panel[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
    if (tab.dataset.tab === 'upload' && state.backend !== 'remote') {
      setStatus(t('st.uploadlocal'), 'err');
    }
    updateSave();
  }),
);

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#addSave');
  btn.disabled = true;
  const tab = $('#addDialog .tab.active').dataset.tab;
  try {
    let fileUrl = '';
    if (tab === 'upload') {
      $('#upProgress').hidden = false;
      const stored = await getStorage().putFile('videos/', pickedFile, (pct) => ($('#upProgress').value = pct));
      fileUrl = '/' + stored.replace(/^\/+/, '');
    }
    const wantOg = $('#pvUseOg').checked && draft.image;
    const rawThumb = wantOg ? draft.image : draft.thumbnail;
    const thumb = rawThumb && /^https?:/i.test(rawThumb) ? await copyCover(rawThumb, draft.url || undefined) : rawThumb || '';
    const rec = {
      title: ($('#pvTitle').value || draft.title || pickedFile?.name || hostOf(draft.url) || 'Untitled').trim(),
      url: draft.url || fileUrl,
      kind: tab === 'upload' ? 'file' : draft.kind,
      provider: tab === 'upload' ? 'file' : draft.provider,
      videoId: draft.videoId,
      embedUrl: draft.embedUrl || '',
      fileUrl: fileUrl || draft.fileUrl || '',
      tags: ($('#pvTags').value || '')
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 12),
      notes: $('#pvNotes').value.trim(),
      startAt: parseTime($('#pvStart').value) ?? 0,
      thumbnail: thumb,
      thumbSource: wantOg ? 'page-image' : draft.thumbnail ? 'provider' : 'auto',
      thumbTime: null,
      favicon: draft.favicon,
      site: draft.site,
      duration: draft.duration,
      folderId: $('#pvFolder').value || '',
      addedAt: new Date().toISOString(),
    };
    const saved = await addItem(rec);
    addDialog.close();
    toast(t('to.added', { title: saved.title }), 'ok');
    if (saved.data?.kind === 'file') autoThumbnail(saved);
    $('#grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    updateSave();
  }
});

$('#addBtn').addEventListener('click', () => openAdd());
$$('[data-open="add"]').forEach((b) => b.addEventListener('click', () => openAdd()));

export function openAdd(tabName) {
  newDraft();
  if (tabName) $(`#addDialog .tab[data-tab="${tabName}"]`)?.click();
  addDialog.showModal();
  setTimeout(() => $('#addUrl').focus(), 40);
}

/* entry points for drag & drop */
export function addFromLink(link) {
  openAdd('link');
  $('#addUrl').value = link;
  enrich(link);
  updateSave();
}
export function addFromEmbed(raw) {
  openAdd('embed');
  $('#addEmbed').value = raw;
  $('#addEmbed').dispatchEvent(new Event('input'));
}
export function addFromFile(file) {
  openAdd('upload');
  pickedFile = file;
  $('#dropLabel').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  $('#pvTitle').value = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  draft.title = $('#pvTitle').value;
  draft.url = '';
  draft.kind = 'file';
  draft.provider = 'file';
  setDetected(file.name, `${(file.size / 1048576).toFixed(1)} MB`, true);
  paintPreview();
  updateSave();
}

/* =============================================================== edit */

const editDialog = $('#editDialog');
let editing = null;

export const editingItem = () => editing;

export function paintEditThumb() {
  if (!editing) return;
  const thumb = thumbnailFor(editing);
  $('#edThumb').innerHTML = thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : `<span class="placeholder">${esc(t('preview.none'))}</span>`;
}

export function openEdit(id) {
  const v = byId(id);
  if (!v) return;
  const d = v.data || {};
  editing = v;
  paintEditThumb();
  $('#edTitle').value = v.title || '';
  $('#edTags').value = (v.tags || []).join(', ');
  $('#edStart').value = d.startAt ? fmtTime(d.startAt) : '';
  $('#edNotes').value = v.notes || '';
  $('#edUrl').value = v.url || '';
  $('#edEmbed').value = d.playerUrl || (d.kind === 'embed' ? PROVIDERS[d.provider]?.embed?.({ videoId: d.videoId }, 0) || '' : '');
  $('#edKind').textContent = `${d.kind}${d.provider ? ' · ' + labelOf(v) : ''} · ${t(canPickFrames(v, state.backend) ? 'edit.frames.ok' : 'edit.frames.no')}`;
  $('#edFrame').disabled = !canPickFrames(v, state.backend);
  $('#edFrame').title = t(canPickFrames(v, state.backend) ? 'edit.frame.ok' : 'edit.frame.no');
  if (!editDialog.open) editDialog.showModal();
}

$('#edFrame').addEventListener('click', () => openThumbPicker(editing.id));

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const d = editing.data || {};
  const embedOverride = normalizeEmbedUrl($('#edEmbed').value);
  const autoEmbed = d.kind === 'embed' && PROVIDERS[d.provider]?.embed ? PROVIDERS[d.provider].embed({ videoId: d.videoId }, 0) : '';
  patch(editing.id, {
    title: $('#edTitle').value.trim() || editing.title || 'Untitled',
    tags: ($('#edTags').value || '')
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 12),
    notes: $('#edNotes').value.trim(),
    startAt: parseTime($('#edStart').value) ?? 0,
    url: $('#edUrl').value.trim(),
    embedUrl: embedOverride && embedOverride !== autoEmbed ? embedOverride : '',
  });
  editDialog.close();
  toast(t('to.saved'), 'ok', 1800);
});

$('#edDelete').addEventListener('click', async () => {
  if (!(await confirmBox(t('cf.title'), t('cf.edit')))) return;
  const id = editing.id;
  await removeItem(id);
  editDialog.close();
  if ($('#lightbox').open) closePlayer();
  toast(t('to.deleted'), '', 1800);
});

$('#edDefault').addEventListener('click', async () => {
  patch(editing.id, { thumbnail: '', thumbSource: 'auto', thumbTime: null });
  openEdit(editing.id);
});

$('#edImage').addEventListener('click', () => $('#tpUpload').click());
$('#edImageUrl').addEventListener('click', () => {
  const url = window.prompt(t('prompt.imageurl'), 'https://');
  if (url && url !== 'https://') setThumbnail(editing.id, url.trim(), 'url');
});

/* =============================================================== move */

const moveDialog = $('#moveDialog');
let moveTarget = '';

export function paintMoveList() {
  $('#mvList').innerHTML =
    `<button type="button" class="move-opt${moveTarget === '' ? ' on' : ''}" data-mv=""><svg><use href="#i-folder" /></svg><span class="grow">${esc(t('folder.unfiled'))}</span></button>` +
    state.folders
      .map(
        (f) =>
          `<button type="button" class="move-opt${moveTarget === f.id ? ' on' : ''}" data-mv="${f.id}"><svg><use href="#i-folder" /></svg><span class="grow">${esc(f.name)}</span><span class="icon-btn" data-mv-edit="${f.id}" title="${esc(t('folder.rename'))}"><svg><use href="#i-edit" /></svg></span><span class="icon-btn" data-mv-del="${f.id}" title="${esc(t('folder.delete'))}"><svg><use href="#i-trash" /></svg></span></button>`,
      )
      .join('');
}

export function openMove() {
  if (!state.selected.size) return;
  moveTarget = '';
  $('#mvNew').value = '';
  paintMoveList();
  moveDialog.showModal();
}

$('#mvList').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-mv-edit]');
  if (edit) return renameFolderPrompt(edit.dataset.mvEdit);
  const del = e.target.closest('[data-mv-del]');
  if (del) return deleteFolder(del.dataset.mvDel);
  const opt = e.target.closest('[data-mv]');
  if (!opt) return;
  moveTarget = opt.dataset.mv;
  paintMoveList();
});

$('#mvCreate').addEventListener('click', async () => {
  const name = $('#mvNew').value.trim();
  if (!name) return toast(t('move.noname'), 'err');
  try {
    const f = createFolder(name);
    moveTarget = f.id;
    $('#mvNew').value = '';
    paintMoveList();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#moveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ids = [...state.selected];
  if (!ids.length) return;
  const target = moveTarget;
  moveDialog.close();
  setSelecting(false);
  await moveIds(ids, target);
});

/* ====================================================== shared wiring */

$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    const dlg = b.closest('dialog');
    dlg?.close();
    if (dlg === addDialog) $('#addSave').disabled = false;
  }),
);

[addDialog, editDialog].forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }),
);

export { addDialog, editDialog, moveDialog };
