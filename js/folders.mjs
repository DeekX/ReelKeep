/* ReelKeep folders & selection — organize items without touching storage. */

import { $ } from './util.mjs';
import { toast, confirmBox } from './ui.mjs';
import { state, createFolder, renameFolder, removeFolder, moveItems } from './library.mjs';
import { render, setSelecting } from './views.mjs';
import { openMove, paintMoveList, moveDialog } from './dialogs.mjs';
import { endDrag } from './dnd.mjs';

export async function moveIds(ids, folderId) {
  try {
    const n = moveItems(ids, folderId);
    // render() detaches the dragged card, so native dragend may never reach #grid
    endDrag();
    const name = state.folders.find((f) => f.id === folderId)?.name || t('folder.unfiled');
    toast(t('move.moved', { n: t(n === 1 ? 'count.one' : 'count.other', { n }), name }), 'ok', 2200);
  } catch (err) {
    toast(t('move.fail', { err: err.message }), 'err');
  }
}

export async function createFolderPrompt() {
  const name = (window.prompt(t('folder.prompt.new')) || '').trim();
  if (!name) return;
  try {
    createFolder(name);
    toast(t('folder.created', { name }), 'ok', 1800);
  } catch (err) {
    toast(err.message, 'err');
  }
}

export async function renameFolderPrompt(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const name = (window.prompt(t('folder.prompt.rename'), f.name) || '').trim();
  if (!name || name === f.name) return;
  try {
    renameFolder(id, name);
  } catch (err) {
    toast(err.message, 'err');
  }
}

export async function deleteFolder(id) {
  const f = state.folders.find((x) => x.id === id);
  if (!f) return;
  const n = state.items.filter((v) => v.folderId === id).length;
  if (!(await confirmBox(t('folder.delete.title', { name: f.name }), t('folder.delete.text', { n })))) return;
  try {
    await removeFolder(id);
    if (moveDialog.open) paintMoveList();
    toast(t('folder.deleted'), '', 1800);
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#faEmpty').addEventListener('click', () => {
  const ids = state.items.filter((v) => v.folderId === state.folder).map((v) => v.id);
  if (ids.length) moveIds(ids, '');
});
$('#faRename').addEventListener('click', () => renameFolderPrompt(state.folder));
$('#faDelete').addEventListener('click', () => deleteFolder(state.folder));

const folderbar = $('#folderbar');
folderbar.addEventListener('click', (e) => {
  if (e.target.closest('[data-newfolder]')) return createFolderPrompt();
  const chip = e.target.closest('[data-folder]');
  if (!chip) return;
  state.folder = chip.dataset.folder;
  state.limit = 60;
  render();
});
folderbar.addEventListener('dblclick', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (!chip || chip.dataset.folder === 'all' || chip.dataset.folder === 'unfiled') return;
  renameFolderPrompt(chip.dataset.folder);
});

$('#selectBtn').addEventListener('click', () => setSelecting(!state.selecting));
$('#selClear').addEventListener('click', () => setSelecting(false));
$('#selMove').addEventListener('click', openMove);

$('#pageMore').addEventListener('click', () => {
  state.limit += 60;
  render();
});

/* mobile overflow menu for the organization controls */
$('#menuBtn').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  $('#menuBtn').setAttribute('aria-pressed', String(open));
});
document.addEventListener('click', (e) => {
  if (!document.body.classList.contains('menu-open')) return;
  if (e.target.closest('.libhead-controls') || e.target.closest('#menuBtn')) return;
  document.body.classList.remove('menu-open');
  $('#menuBtn').setAttribute('aria-pressed', 'false');
});
