/* ReelKeep — vanilla ES modules, no build step.
   Works against server.js (companion tier) or falls back to browser storage.
   This entry wires the modules together and boots the library. */

import { $, $$ } from './js/util.mjs';
import { toast } from './js/ui.mjs';
import { state, byId, patch, addItem, removeItem, initLibrary, setOnChange, flushSave, getStorage } from './js/library.mjs';
import { createServerStorage, createLocalStorage } from './js/storage.mjs';
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
  setBackend(state.backend);
  if (editDialog.open && editingItem()) openEdit(editingItem().id);
  if ($('#lightbox').open && state.current) {
    paintLbMeta(state.current);
    paintLbDetails(state.current);
  }
  if (moveDialog.open) paintMoveList();
  if (!$('#pvStatus').hidden) $('#pvStatusText').textContent = t('add.preview.ok');
});

/* ============================================================== backend */

function setBackend(mode) {
  state.backend = mode;
  const el = $('#backend');
  el.className = 'dot ' + (mode === 'remote' ? 'live' : 'local');
  const demo = /(^|\.)github\.io$/.test(location.hostname);
  el.textContent = mode === 'remote' ? t('foot.remote') : t('foot.local');
  $('#topDot').className = 'dot ' + (mode === 'remote' ? 'live' : 'local');
  $('#topStatus').textContent = mode === 'remote' ? t('top.status.live') : t('top.status.local');
  $('#tip').textContent = mode === 'remote' ? t('foot.tip.remote') : demo ? t('foot.tip.demo') : t('foot.tip.local');
}

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
    const probe = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (!probe.ok) throw new Error();
    setBackend('remote');
  } catch {
    setBackend('local');
  }
  const storage = state.backend === 'remote' ? createServerStorage() : createLocalStorage();
  try {
    await initLibrary(storage);
  } catch (err) {
    toast(t('to.loadfail', { err: err.message }), 'err');
  }
  // Browser-only mode (GitHub Pages demo, file://): start from the example
  // library once, so a first visit is never an empty grid.
  if (state.backend !== 'remote' && !state.items.length) {
    let touched = true;
    try {
      touched = localStorage.getItem('video-gallery.v1') !== null;
    } catch {
      /* storage blocked */
    }
    if (!touched) {
      try {
        const res = await fetch('data/videos.example.json');
        if (res.ok) {
          const migrated = migrateLibrary(await res.json(), { now: new Date().toISOString() });
          state.items = migrated.data.items || [];
          state.folders = migrated.data.folders || [];
          await storage.writeLibrary(migrated.data);
        }
      } catch {
        /* offline or file:// — an empty gallery is fine */
      }
    }
  }
  render();
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

boot();
