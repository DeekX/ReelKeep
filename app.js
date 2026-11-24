/* ReelKeep — vanilla ES modules, no build step.
   Works against server.js (companion tier) or falls back to browser storage.
   This entry wires the modules together and boots the library. */

import { $, $$, esc } from './js/util.mjs';
import { toast } from './js/ui.mjs';
import { state, byId, patch, addItem, removeItem, initLibrary, setOnChange, flushSave, getStorage, warmFileUrls, snapshot } from './js/library.mjs';
import { createServerStorage, createLocalStorage } from './js/storage.mjs';
import {
  createFolderStorage, createOpfsStorage, hasOpfs, hasFolderPicker,
  saveFolderHandle, loadFolderHandle,
} from './js/storage-handles.mjs';
import { createIdbStorage, hasIdb } from './js/storage-idb.mjs';
import { registerHandler } from './js/handlers/registry.mjs';
import { videoHandler } from './js/handlers/video.mjs';
import { linkHandler } from './js/handlers/link.mjs';
import { articleHandler } from './js/handlers/article.mjs';
import { imageHandler } from './js/handlers/image.mjs';
import { audioHandler } from './js/handlers/audio.mjs';
import { pdfHandler } from './js/handlers/pdf.mjs';
import { noteHandler } from './js/handlers/note.mjs';
import { fileHandler } from './js/handlers/file.mjs';
import { migrateLibrary } from './js/migrations.mjs';
import { render, startRename, toggleSelect, setSelecting } from './js/views.mjs';
import { openPlayer, paintLbMeta, paintLbDetails, closePlayer } from './js/lightbox.mjs';
import { openAdd, openEdit, openMove, editingItem, paintMoveList, addDialog, editDialog, moveDialog } from './js/dialogs.mjs';
import { autoThumbnail, startDurationBackfill } from './js/auto.mjs';
import { initHandoff } from './js/handoff.mjs';
import { confirmBox } from './js/ui.mjs';
import { thumbDialog, isPickerReady, openThumbPicker } from './js/thumbpicker.mjs';
import './js/folders.mjs';
import './js/dnd.mjs';
import './js/keyboard.mjs';

registerHandler(videoHandler);
registerHandler(articleHandler);
registerHandler(imageHandler);
registerHandler(audioHandler);
registerHandler(pdfHandler);
registerHandler(noteHandler);
registerHandler(fileHandler);
registerHandler(linkHandler);
setOnChange(render);

/* ====================================================== view & group */

const VIEW_KEY = 'video-gallery.view';

export function applyView(mode) {
  state.view = mode === 'list' ? 'list' : 'grid';
  $('#grid').classList.toggle('list', state.view === 'list');
  $('#viewGrid').classList.toggle('on', state.view === 'grid');
  $('#viewList').classList.toggle('on', state.view === 'list');
  $('#viewGrid').setAttribute('aria-pressed', String(state.view === 'grid'));
  $('#viewList').setAttribute('aria-pressed', String(state.view === 'list'));
  try {
    localStorage.setItem(VIEW_KEY, state.view);
  } catch {
    /* private mode or file:// — the choice just won't be remembered */
  }
}

$('#viewGrid').addEventListener('click', () => applyView('grid'));
$('#viewList').addEventListener('click', () => applyView('list'));

const GROUP_KEY = 'video-gallery.group';

export function applyGroup(on) {
  state.group = !!on;
  $('#groupBtn').classList.toggle('on', state.group);
  $('#groupBtn').setAttribute('aria-pressed', String(state.group));
  try {
    localStorage.setItem(GROUP_KEY, state.group ? '1' : '0');
  } catch {
    /* private mode or file:// */
  }
  render();
}

$('#groupBtn').addEventListener('click', () => applyGroup(!state.group));

/* ========================================================= grid events */

$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const v = byId(card.dataset.id);
  if (state.selecting) return toggleSelect(v.id);
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'edit') return openEdit(v.id);
  if (act === 'del') {
    return confirmBox(t('cf.title'), t('cf.card', { title: v.title })).then(async (yes) => {
      if (!yes) return;
      await removeItem(v.id);
      toast(t('to.deleted'), '', 1800);
    });
  }
  if (act === 'rename') return;
  openPlayer(v.id);
});

$('#grid').addEventListener('dblclick', (e) => {
  const card = e.target.closest('.card');
  if (!card || state.selecting) return;
  startRename(byId(card.dataset.id), e.target.closest('[data-act="rename"]'));
});

$('#grid').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const card = e.target.closest('.card');
  if (!card) return;
  state.selecting ? toggleSelect(card.dataset.id) : openPlayer(card.dataset.id);
});

/* ================================================== search / sort / filter */

$('#search').addEventListener('input', (e) => {
  state.q = e.target.value;
  state.tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  state.limit = 60;
  render();
});

$('#sortSel').addEventListener('change', (e) => {
  state.sort = e.target.value;
  render();
});
$('#providerSel').addEventListener('change', (e) => {
  state.provider = e.target.value;
  state.limit = 60;
  render();
});
$('#typeSel').addEventListener('change', (e) => {
  state.type = e.target.value;
  state.limit = 60;
  render();
});

$('#tagbar').addEventListener('click', (e) => {
  if (e.target.closest('[data-tagreset]')) {
    state.tags.clear();
    state.limit = 60;
    render();
    return;
  }
  const chip = e.target.closest('[data-tag]');
  if (!chip) return;
  const tag = chip.dataset.tag;
  state.tags.has(tag) ? state.tags.delete(tag) : state.tags.add(tag);
  state.limit = 60;
  render();
});

/* ============================================================== locale */

$('#langSel').addEventListener('change', (e) => setLocale(e.target.value));
document.addEventListener('reelkeep:locale', () => {
  $('#langSel').value = i18nCurrent();
  render();
  setBackend(state.mode);
  if (editDialog.open && editingItem()) openEdit(editingItem().id);
  if ($('#lightbox').open && state.current) {
    paintLbMeta(state.current);
    paintLbDetails(state.current);
  }
  if (moveDialog.open) paintMoveList();
  if (!$('#pvStatus').hidden) $('#pvStatusText').textContent = t('add.preview.ok');
});

/* ============================================================== backend */

let serverAvailable = false;
let pendingFolder = null; // handle awaiting a permission gesture
let savedMode = null; // last chosen mode, remembered across sessions

function setBackend(mode) {
  state.mode = mode;
  state.backend = mode === 'server' ? 'remote' : 'local';
  const live = mode === 'server' || mode === 'folder';
  const el = $('#backend');
  const offline = !!getStorage()?.offline;
  el.className = 'dot ' + (live && !offline ? 'live' : 'local');
  const demo = /(^|\.)github\.io$/.test(location.hostname);
  el.textContent = offline
    ? t('foot.offline')
    : mode === 'server' ? t('foot.remote') : mode === 'folder' ? t('foot.folder') : mode === 'opfs' ? t('foot.opfs') : mode === 'idb' ? t('foot.idb') : t('foot.local');
  $('#libPath').textContent =
    mode === 'server' ? 'data/library.json' : mode === 'folder' ? `${state.folderName || 'folder'}/library.json` : mode === 'local' ? 'localStorage' : 'library.json';
  $('#topDot').className = 'dot ' + (live ? 'live' : 'local');
  $('#topStatus').textContent = live ? t('top.status.live') : t('top.status.local');
  $('#tip').textContent = mode === 'server' ? t('foot.tip.remote') : demo ? t('foot.tip.demo') : t('foot.tip.local');
}

/* ------------------------------------------------------- storage mode UI */

const modeDialog = $('#modeDialog');

function paintModeList() {
  const rows = [
    { id: 'server', label: t('mode.server'), sub: t('mode.server.sub'), ok: serverAvailable },
    { id: 'folder', label: t('mode.folder'), sub: t('mode.folder.sub'), ok: hasFolderPicker(), action: pendingFolder ? t('mode.folder.reconnect') : t('mode.folder.pick') },
    { id: 'browser', label: t('mode.browser'), sub: t('mode.browser.sub'), ok: true },
  ];
  $('#modeList').innerHTML = rows
    .map(
      (r) => `<button type="button" class="mode-opt${state.mode === r.id || (r.id === 'browser' && ['opfs', 'idb', 'local'].includes(state.mode)) ? ' on' : ''}" data-mode="${r.id}" ${r.ok ? '' : 'disabled'}>
        <span class="grow"><b>${esc(r.label)}</b><small>${esc(r.sub)}</small></span>
        ${state.mode === r.id || (r.id === 'browser' && ['opfs', 'idb', 'local'].includes(state.mode)) ? `<span class="mode-cur">${esc(t('mode.current'))}</span>` : ''}
        ${r.action && state.mode !== r.id ? `<span class="btn">${esc(r.action)}</span>` : ''}
      </button>`,
    )
    .join('');
}

async function switchMode(storage, mode, folderName = '') {
  try {
    await flushSave().catch(() => {});
    await storage.open();
    const existing = await storage.readLibrary();
    if (!existing) await storage.writeLibrary({ ...snapshot(), rev: 1 });
    await initLibrary(storage);
    state.folderName = folderName;
    try {
      localStorage.setItem('reelkeep.mode', mode);
    } catch {
      /* private mode */
    }
    await warmFileUrls();
    setBackend(mode);
    render();
    modeDialog.close();
    toast(t('mode.switched'), 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#modeBtn').addEventListener('click', () => {
  paintModeList();
  modeDialog.showModal();
});

$('#modeList').addEventListener('click', async (e) => {
  const opt = e.target.closest('[data-mode]');
  if (!opt || opt.disabled) return;
  const which = opt.dataset.mode;
  if (which === 'server') {
    if (!serverAvailable) return toast(t('mode.needserver'), 'err');
    return switchMode(createServerStorage(), 'server');
  }
  if (which === 'folder') {
    try {
      let handle = pendingFolder;
      if (handle) {
        const perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return toast(t('mode.denied'), 'err');
      } else {
        handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      }
      await saveFolderHandle(handle);
      pendingFolder = null;
      return switchMode(createFolderStorage(handle), 'folder', handle.name);
    } catch (err) {
      if (err?.name !== 'AbortError') toast(t('mode.denied'), 'err');
      return;
    }
  }
  // browser storage: best available backend
  const b = pickBrowser();
  return switchMode(b.storage, b.mode);
});

function pickBrowser() {
  if (hasOpfs()) return { storage: createOpfsStorage(), mode: 'opfs' };
  if (hasIdb()) return { storage: createIdbStorage(), mode: 'idb' };
  return { storage: createLocalStorage(), mode: 'local' };
}

/* password auth: login dialog at boot and on mid-session 401 */
function loginFlow() {
  return new Promise((resolve) => {
    const dlg = $('#loginDialog');
    $('#loginError').hidden = true;
    $('#loginPassword').value = '';
    const done = (v) => {
      dlg.close();
      resolve(v);
    };
    $('#loginForm').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#loginPassword').value }),
      });
      if (res.ok) return done(true);
      const err = $('#loginError');
      err.hidden = false;
      err.textContent = res.status === 429 ? t('auth.wait') : t('auth.bad');
    };
    $('#loginBrowser').onclick = () => done(false);
    dlg.showModal();
    setTimeout(() => $('#loginPassword').focus(), 40);
  });
}

document.addEventListener('reelkeep:auth', async () => {
  const ok = await loginFlow();
  if (ok) {
    await initLibrary(getStorage());
    await warmFileUrls();
    render();
  } else {
    const b = pickBrowser();
    await switchMode(b.storage, b.mode);
  }
});

modeDialog.addEventListener('click', (e) => {
  if (e.target === modeDialog) modeDialog.close();
});

/* ================================================================= boot */

async function boot() {
  let savedView = 'grid';
  try {
    savedView = localStorage.getItem(VIEW_KEY) || 'grid';
  } catch {
    /* storage blocked */
  }
  applyView(savedView);
  let savedGroup = false;
  try {
    savedGroup = localStorage.getItem(GROUP_KEY) === '1';
  } catch {
    /* storage blocked */
  }
  applyGroup(savedGroup);
  $('#langSel').value = i18nCurrent();
  try {
    savedMode = localStorage.getItem('reelkeep.mode');
  } catch {
    /* storage blocked */
  }
  let session = null;
  try {
    const probe = await fetch('/api/session', { headers: { Accept: 'application/json' } });
    if (!probe.ok) throw new Error();
    session = await probe.json();
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
  if (serverAvailable && session.required && !session.authenticated) {
    const unlocked = await loginFlow();
    if (!unlocked) {
      serverAvailable = false;
      savedMode = 'browser';
    }
  }
  let storage;
  let mode;
  let folderName = '';
  // a remembered server mode stays server mode even offline: the adapter then
  // serves the last synced copy read-only instead of silently switching tiers
  if (serverAvailable || savedMode === 'server') {
    storage = createServerStorage();
    mode = 'server';
  } else {
    const saved = savedMode;
    if (saved === 'folder' && hasFolderPicker()) {
      const handle = await loadFolderHandle();
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          storage = createFolderStorage(handle);
          mode = 'folder';
          folderName = handle.name;
        } else {
          pendingFolder = handle; // reconnect needs a user gesture (mode dialog)
        }
      }
    }
    if (!storage) {
      if (saved === 'local' || (!hasOpfs() && !hasIdb())) {
        storage = createLocalStorage();
        mode = 'local';
      } else if (hasOpfs()) {
        storage = createOpfsStorage();
        mode = 'opfs';
      } else {
        storage = createIdbStorage();
        mode = 'idb';
      }
    }
  }
  state.folderName = folderName;
  setBackend(mode);
  try {
    localStorage.setItem('reelkeep.mode', mode);
  } catch {
    /* private mode */
  }
  try {
    await initLibrary(storage);
  } catch (err) {
    toast(t('to.loadfail', { err: err.message }), 'err');
  }
  setBackend(mode); // refresh after load: offline mirror may have engaged
  // Browser-only modes: start from the example library once, so a first visit
  // is never an empty grid.
  if (mode !== 'server' && !state.items.length && !state.folders.length) {
    try {
      const res = await fetch('data/videos.example.json');
      if (res.ok) {
        const migrated = migrateLibrary(await res.json(), { now: new Date().toISOString() });
        state.items = migrated.data.items || [];
        state.folders = migrated.data.folders || [];
        state.rev = 1;
        await storage.writeLibrary({ ...migrated.data, rev: 1 });
      }
    } catch {
      /* offline — an empty gallery is fine */
    }
  }
  await warmFileUrls();
  render();
  initHandoff();
  // give playable videos without a cover their default frame (the opening shot)
  const missing = state.items
    .filter((v) => v.type === 'video' && v.data?.kind === 'file' && (!v.cover || v.cover.kind === 'none'))
    .slice(0, 4);
  missing.forEach((v, i) => setTimeout(() => autoThumbnail(v), 400 + i * 700));
  startDurationBackfill();
}

/* Dev/screenshot hook (scripts/screenshot.mjs drives the app through this).
   The UI itself never uses it. */
window.ReelKeep = {
  state,
  applyView,
  applyGroup,
  openPlayer,
  closePlayer,
  openAdd,
  openMove,
  openThumbPicker,
  setSelecting,
  toggleSelect,
  setLocale,
  addDialog,
  editDialog,
  moveDialog,
  thumbDialog,
  isPickerReady,
  add: addItem,
  patch,
  removeItem,
};

// never lose a debounced save when the tab goes away
window.addEventListener('pagehide', () => {
  flushSave().catch(() => {});
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave().catch(() => {});
});

/* PWA: installable, offline app shell. Updates wait for an explicit reload so
   a new version never yanks the rug mid-session. */
let refreshing = false;
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker
    .register('sw.js')
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast(t('pwa.update'), '', 12000, {
              label: t('pwa.reload'),
              fn: () => {
                refreshing = true;
                nw.postMessage('SKIP_WAITING');
              },
            });
          }
        });
      });
    })
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) location.reload();
  });
}

boot();
