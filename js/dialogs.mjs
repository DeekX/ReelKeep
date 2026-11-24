/* ReelKeep dialogs — add item (auto-detected type, overridable), edit details
   (per-type panels from handlers), move to folder, import with preview + undo.
   All persistence goes through the library core. */

import { $, $$, esc, assetUrl, hostOf, parseUrl, parseTime, fmtTime, debounce, fmtBytes } from './util.mjs';
import { toast, confirmBox } from './ui.mjs';
import {
  state, byId, patch, addItem, removeItem, getStorage, copyCover, enrichUrl, createFolder, snapshot, save as saveNow,
} from './library.mjs';
import { PROVIDERS, detect, cleanTitle, normalizeEmbedUrl, providerLabel } from './providers.mjs';
import { labelOf, allHandlers, detectType, coversOf } from './handlers/registry.mjs';
import { canPickFrames } from './handlers/video.mjs';
import { render, thumbnailFor, setSelecting } from './views.mjs';
import { openThumbPicker, setThumbnail, resetCover } from './thumbpicker.mjs';
import { moveIds, renameFolderPrompt, deleteFolder } from './folders.mjs';
import { closePlayer } from './lightbox.mjs';
import { autoThumbnail } from './auto.mjs';
import { migrateLibrary } from './migrations.mjs';
import { validateLibrary } from './schema.mjs';

/* ================================================================ add */

const addDialog = $('#addDialog');
let draft = null;
let pickedFile = null;

function typeOptions(selected) {
  return allHandlers()
    .map((h) => `<option value="${h.type}"${h.type === selected ? ' selected' : ''}>${esc(t('type.' + h.type))}</option>`)
    .join('');
}

function newDraft() {
  draft = {
    type: 'video',
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
    meta: null,
  };
  pickedFile = null;
  $('#addUrl').value = '';
  $('#addEmbed').value = '';
  $('#addFile').value = '';
  $('#addNote').value = '';
  $('#pvTitle').value = '';
  $('#pvTags').value = '';
  $('#pvStart').value = '';
  $('#pvNotes').value = '';
  $('#pvUseOg').checked = true;
  setDetectedType('video', false);
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
  const ok =
    tab === 'link' ? !!draft.url : tab === 'embed' ? !!draft.embedUrl : tab === 'note' ? !!$('#addNote').value.trim() : !!pickedFile;
  $('#addSave').disabled = !ok;
}

function setDetectedType(type, auto) {
  draft.type = type;
  $('#pvType').innerHTML = typeOptions(type);
  $('#pvTypeDetected').textContent = auto ? t('add.detected', { type: t('type.' + type) }) : '';
  // playback extras only make sense for video
  $('#pvStart').closest('.field').hidden = type !== 'video';
  $('#pvUseOg').closest('.switch').hidden = ['note', 'file', 'pdf'].includes(type);
}

function paintPreview() {
  const holder = $('#pvThumb');
  const img = draft.image && $('#pvUseOg').checked ? assetUrl(draft.image) : draft.thumbnail ? assetUrl(draft.thumbnail) : PROVIDERS[draft.provider]?.thumb?.(draft);
  holder.innerHTML = img
    ? `<img src="${esc(assetUrl(img))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()"><span class="ptime">${esc(t('preview.auto'))}</span>`
    : `<span class="placeholder">${esc(t('preview.none'))}</span>`;
  $('#addPreview').hidden = !(draft.url || draft.embedUrl || pickedFile || $('#addNote').value.trim());
  if (!$('#pvDetTitle').textContent) {
    $('#pvDetTitle').textContent = draft.title || hostOf(draft.url) || pickedFile?.name || '';
    $('#pvDetSub').textContent = draft.url || draft.embedUrl ? (draft.type === 'video' ? providerLabel(draft) : t('type.' + draft.type)) : '';
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
  setDetectedType(detectType({ url: u.href }), true);
  paintPreview();
  if (found.kind === 'invalid') return setStatus(t('st.invalid'), 'err');
  if (state.backend !== 'remote') return setStatus(t('st.localenrich'), 'err');
  setStatus(t('st.reading', { host: hostOf(u.href) }), 'busy');
  try {
    const meta = await enrichUrl(u.href);
    if (draft.url !== u.href) return; // superseded by a newer paste
    if (!meta || meta.error) throw new Error(meta?.error || 'no metadata');
    draft.meta = meta;
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
      `${draft.type === 'video' ? providerLabel(draft) : t('type.' + draft.type)}${draft.site ? ' · ' + draft.site : ''}${draft.duration ? ' · ' + fmtTime(draft.duration) : ''}`,
      true,
    );
    if (draft.type === 'video' && found.kind === 'page' && meta.mediaUrl) {
      draft.kind = 'file';
      draft.provider = 'file';
      draft.fileUrl = meta.mediaUrl;
      setStatus(t('st.direct'), 'ok');
    } else if (draft.type === 'video' && found.kind === 'page') {
      setStatus(t('st.page'), '');
    } else {
      setStatus(t('st.detected', { provider: t('type.' + draft.type) }), 'ok');
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
$('#pvType').addEventListener('change', (e) => {
  draft.type = e.target.value;
  $('#pvTypeDetected').textContent = '';
  paintPreview();
});
$('#addNote').addEventListener('input', () => {
  paintPreview();
  updateSave();
});

$('#addEmbed').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  const found = /<iframe[^>]*src\s*=\s*["']([^"']+)["']/i.exec(raw)?.[1] || (/^<iframe/i.test(raw) ? null : raw);
  const src = normalizeEmbedUrl(found);
  draft.embedUrl = src;
  draft.kind = src ? 'embed' : 'page';
  draft.provider = PROVIDERS.youtube.test(hostOf(src || '')) ? 'youtube' : 'custom';
  if (src) {
    draft.url = draft.url || src;
    setDetectedType('video', false);
    setStatus(t('st.embedok', { url: src }), 'ok');
  } else setStatus(t('st.embedhelp'), '');
  paintPreview();
  updateSave();
});

const dropField = $('#dropField');
$('#addFile').addEventListener('change', (e) => {
  pickedFile = e.target.files?.[0] || null;
  if (pickedFile) {
    $('#dropLabel').textContent = `${pickedFile.name} · ${fmtBytes(pickedFile.size)}`;
    if (!$('#pvTitle').value) $('#pvTitle').value = pickedFile.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
    draft.title = $('#pvTitle').value;
    draft.url = '';
    setDetectedType(detectType({ file: pickedFile }), true);
    if (draft.type === 'video') {
      draft.kind = 'file';
      draft.provider = 'file';
    }
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
    if (tab.dataset.tab === 'note') setDetectedType('note', false);
    updateSave();
  }),
);

const commonInput = () => ({
  title: ($('#pvTitle').value || draft.title || pickedFile?.name || hostOf(draft.url) || '').trim(),
  tags: ($('#pvTags').value || '')
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 12),
  notes: $('#pvNotes').value.trim(),
  folderId: $('#pvFolder').value || '',
});

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#addSave');
  btn.disabled = true;
  const tab = $('#addDialog .tab.active').dataset.tab;
  try {
    let saved;
    if (tab === 'note') {
      saved = await addItem({ type: 'note', body: $('#addNote').value, ...commonInput() });
    } else if (tab === 'upload') {
      $('#upProgress').hidden = false;
      const dir = draft.type === 'video' ? 'videos/' : 'files/';
      const stored = await getStorage().putFile(dir, pickedFile, (pct) => ($('#upProgress').value = pct));
      const base = { ...commonInput(), path: stored, title: commonInput().title || pickedFile.name };
      if (draft.type === 'video') {
        const fileUrl = '/' + stored.replace(/^\/+/, '');
        saved = await addItem({
          ...base,
          type: 'video',
          url: fileUrl,
          kind: 'file',
          provider: 'file',
          videoId: null,
          embedUrl: '',
          fileUrl,
          startAt: parseTime($('#pvStart').value) ?? 0,
          thumbnail: '',
          thumbSource: 'auto',
          thumbTime: null,
          favicon: '',
          site: '',
          duration: null,
          addedAt: new Date().toISOString(),
        });
      } else if (draft.type === 'file') {
        saved = await addItem({ ...base, type: 'file', fileName: pickedFile.name, size: pickedFile.size, mime: pickedFile.type, blob: pickedFile });
      } else {
        saved = await addItem({ ...base, type: draft.type, mime: pickedFile.type, size: pickedFile.size });
      }
    } else {
      // link / embed tabs
      const wantOg = $('#pvUseOg').checked && draft.image;
      const rawThumb = wantOg ? draft.image : draft.thumbnail;
      const thumb = rawThumb && /^https?:/i.test(rawThumb) ? await copyCover(rawThumb, draft.url || undefined) : rawThumb || '';
      const base = { ...commonInput(), site: draft.site, duration: draft.duration };
      if (draft.type === 'video') {
        saved = await addItem({
          ...base,
          type: 'video',
          url: draft.url || draft.embedUrl,
          kind: tab === 'embed' ? 'embed' : draft.kind,
          provider: draft.provider,
          videoId: draft.videoId,
          embedUrl: draft.embedUrl || '',
          fileUrl: draft.fileUrl || '',
          startAt: parseTime($('#pvStart').value) ?? 0,
          thumbnail: thumb,
          thumbSource: wantOg ? 'page-image' : draft.thumbnail ? 'provider' : 'auto',
          thumbTime: null,
          favicon: draft.favicon,
          addedAt: new Date().toISOString(),
        });
      } else {
        const cover = thumb ? { kind: /^(thumbnails|files)\//.test(thumb) ? 'file' : 'url', path: thumb, origin: wantOg ? 'auto' : 'url' } : undefined;
        saved = await addItem({ ...base, type: draft.type, url: draft.url || draft.embedUrl, meta: draft.meta, cover });
      }
    }
    addDialog.close();
    toast(t('to.added', { title: saved.title }), 'ok');
    if (saved.type === 'video' && saved.data?.kind === 'file') autoThumbnail(saved);
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
  setTimeout(() => (tabName === 'note' ? $('#addNote') : $('#addUrl')).focus(), 40);
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
  $('#dropLabel').textContent = `${file.name} · ${fmtBytes(file.size)}`;
  $('#pvTitle').value = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ');
  draft.title = $('#pvTitle').value;
  draft.url = '';
  setDetectedType(detectType({ file }), true);
  if (draft.type === 'video') {
    draft.kind = 'file';
    draft.provider = 'file';
  }
  setDetected(file.name, fmtBytes(file.size), true);
  paintPreview();
  updateSave();
}
export function addFromText(text) {
  openAdd('note');
  $('#addNote').value = text;
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
  editing = v;
  paintEditThumb();
  $('#edTitle').value = v.title || '';
  $('#edTags').value = (v.tags || []).join(', ');
  $('#edNotes').value = v.notes || '';
  const extra = $('#edExtra');
  extra.textContent = '';
  const handler = allHandlers().find((h) => h.type === v.type);
  handler?.editExtra?.(extra, v, { t, esc });
  if (v.type === 'video') {
    const kind = extra.querySelector('#edKind');
    if (kind) {
      kind.textContent = `${v.data?.kind}${v.data?.provider ? ' · ' + labelOf(v) : ''} · ${t(canPickFrames(v, state.backend) ? 'edit.frames.ok' : 'edit.frames.no')}`;
    }
  }
  $('.thumb-actions').hidden = !coversOf(v);
  if (!editDialog.open) editDialog.showModal();
}

$('#edFrame').addEventListener('click', () => openThumbPicker(editing.id));

$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const handler = allHandlers().find((h) => h.type === editing.type);
  const extraPatch = handler?.collectEdit?.($('#edExtra'), editing) || {};
  patch(editing.id, {
    title: $('#edTitle').value.trim() || editing.title || 'Untitled',
    tags: ($('#edTags').value || '')
      .split(',')
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 12),
    notes: $('#edNotes').value.trim(),
    ...extraPatch,
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
  resetCover(editing.id);
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

/* ====================================================== export / import */

function download(filename, text) {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#exportBtn').addEventListener('click', async () => {
  const bundle = snapshot();
  const storage = getStorage();
  if (storage?.allFiles) {
    // browser-only mode: inline small files so the bundle round-trips alone
    const files = await storage.allFiles();
    const total = Object.values(files).reduce((n, v) => n + v.length, 0);
    if (total <= 8 * 1024 * 1024) bundle.files = files;
    else toast(t('export.toobig'), 'err', 6000);
  }
  download('reelkeep-library.json', JSON.stringify(bundle, null, 2));
  toast(t('export.done'), 'ok');
});

const importDialog = $('#importDialog');
let pendingImport = null;
let undoSnapshot = null;

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return toast(t('import.bad'), 'err');
  }
  const res = migrateLibrary(parsed, { now: new Date().toISOString() });
  if (res.invalid || res.readOnly) return toast(t('import.bad'), 'err');
  const check = validateLibrary(res.data);
  if (!check.ok) return toast(t('import.bad'), 'err');
  const haveIds = new Set(state.items.map((i) => i.id));
  const haveUrls = new Set(state.items.map((i) => i.url).filter(Boolean));
  const fresh = res.data.items.filter((i) => !haveIds.has(i.id) && !(i.url && haveUrls.has(i.url)));
  const dup = res.data.items.length - fresh.length;
  const newFolders = res.data.folders.filter((f) => !state.folders.some((x) => x.id === f.id));
  pendingImport = { items: fresh, folders: newFolders, files: parsed.files || null };
  $('#imPreview').textContent = t('import.preview', { n: res.data.items.length, added: fresh.length, dup });
  $('#imErrors').hidden = true;
  $('#imOk').disabled = !fresh.length && !newFolders.length;
  if (!fresh.length && !newFolders.length) $('#imPreview').textContent = t('import.none');
  importDialog.showModal();
});

$('#imOk').addEventListener('click', async () => {
  if (!pendingImport) return;
  undoSnapshot = { items: state.items, folders: state.folders };
  const storage = getStorage();
  await storage?.createBackup?.('pre-import').catch(() => {});
  if (pendingImport.files && storage?.importFiles) await storage.importFiles(pendingImport.files);
  state.folders = [...state.folders, ...pendingImport.folders];
  state.items = [...pendingImport.items, ...state.items];
  pendingImport = null;
  importDialog.close();
  saveNow();
  render();
  toast(t('import.done', { n: undoSnapshot ? state.items.length - undoSnapshot.items.length : 0 }), 'ok', 8000, {
    label: t('import.undo'),
    fn: () => {
      if (!undoSnapshot) return;
      state.items = undoSnapshot.items;
      state.folders = undoSnapshot.folders;
      undoSnapshot = null;
      saveNow();
      render();
      toast(t('import.undone'), '', 2500);
    },
  });
});

/* ====================================================== shared wiring */

$$('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    const dlg = b.closest('dialog');
    dlg?.close();
    if (dlg === addDialog) $('#addSave').disabled = false;
  }),
);

[addDialog, editDialog, importDialog].forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }),
);

export { addDialog, editDialog, moveDialog, importDialog };
