/* ReelKeep drag & drop — cards onto folder chips, files/links onto the page. */

import { $, $$, esc, parseUrl } from './util.mjs';
import { state, byId } from './library.mjs';
import { moveIds } from './folders.mjs';
import { addFromLink, addFromEmbed, addFromFile, addFromText } from './dialogs.mjs';

export const DRAG_MIME = 'application/x-reelkeep-ids';

$('#grid').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const id = card.dataset.id;
  const ids = state.selecting && state.selected.has(id) ? [...state.selected] : [id];
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
  // compact ghost parked ABOVE the pointer: the drop target under the cursor stays visible
  const ghost = $('#dragGhost');
  const label = ids.length > 1 ? t('count.other', { n: ids.length }) : byId(id)?.title || t('card.untitled');
  ghost.innerHTML = `<svg><use href="#i-folder" /></svg><span>${esc(label)}</span>`;
  e.dataTransfer.setDragImage(ghost, Math.round(ghost.offsetWidth / 2), ghost.offsetHeight + 14);
  document.body.classList.add('drag-ids');
  requestAnimationFrame(() => card.classList.add('dragging'));
});

export function endDrag() {
  document.body.classList.remove('drag-ids');
  $('#dragGhost').innerHTML = '';
  $$('.card.dragging').forEach((c) => c.classList.remove('dragging'));
  $$('.chip.hot').forEach((c) => c.classList.remove('hot'));
}
$('#grid').addEventListener('dragend', endDrag);

const folderbar = $('#folderbar');
folderbar.addEventListener('dragover', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (!chip || chip.dataset.folder === 'all' || !e.dataTransfer.types.includes(DRAG_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  chip.classList.add('hot');
});
folderbar.addEventListener('dragenter', (e) => {
  const chip = e.target.closest('[data-folder]');
  if (chip && chip.dataset.folder !== 'all' && e.dataTransfer.types.includes(DRAG_MIME)) chip.classList.add('hot');
});
folderbar.addEventListener('dragleave', (e) => {
  const chip = e.target.closest('[data-folder]');
  // moving between a chip's own children must not clear the highlight
  if (chip && !chip.contains(e.relatedTarget)) chip.classList.remove('hot');
});
folderbar.addEventListener('drop', async (e) => {
  const chip = e.target.closest('[data-folder]');
  const raw = chip && e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return;
  e.preventDefault();
  chip.classList.remove('hot');
  const target = chip.dataset.folder === 'unfiled' ? '' : chip.dataset.folder;
  if (target === 'all') return;
  await moveIds(JSON.parse(raw), target);
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    $('#dropzone').hidden = true;
    dragDepth = 0;
  }
});
window.addEventListener('drop', async (e) => {
  // internal card drags are handled by the folder chips, never by the upload/link path
  if (e.dataTransfer?.types?.includes(DRAG_MIME)) return;
  e.preventDefault();
  $('#dropzone').hidden = true;
  dragDepth = 0;
  const file = [...(e.dataTransfer?.files || [])][0];
  if (!file) {
    const link = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (link && /<iframe/i.test(link)) addFromEmbed(link);
    else if (link && parseUrl(link) && !link.includes('\n')) addFromLink(link);
    else if (link && link.trim()) addFromText(link);
    return;
  }
  addFromFile(file);
});
