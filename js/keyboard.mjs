/* ReelKeep keyboard shortcuts — disabled while typing in inputs. */

import { $, $$ } from './util.mjs';
import { state } from './library.mjs';
import { setSelecting } from './views.mjs';
import { stepVideo } from './lightbox.mjs';
import { openAdd } from './dialogs.mjs';
import { applyView, applyGroup } from '../app.js';

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ($('#lightbox').open) {
    if (typing) return;
    if (e.key === 'ArrowRight') stepVideo(1);
    if (e.key === 'ArrowLeft') stepVideo(-1);
    if (e.key.toLowerCase() === 'f') $('[data-lb="full"]').click();
    return;
  }
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('#search').focus();
    $('#search').select();
  }
  if (e.key.toLowerCase() === 'n' && !typing && !$$('dialog[open]').length) {
    e.preventDefault();
    openAdd();
  }
  if (e.key.toLowerCase() === 'v' && !typing && !$$('dialog[open]').length) applyView(state.view === 'grid' ? 'list' : 'grid');
  if (e.key.toLowerCase() === 'g' && !typing && !$$('dialog[open]').length) applyGroup(!state.group);
  if (e.key === 'Escape' && state.selecting && !$$('dialog[open]').length) setSelecting(false);
  if (e.key === 'Escape' && typing && document.activeElement === $('#search')) {
    $('#search').value = '';
    state.tokens = [];
    state.q = '';
    // render via the search wiring in app.js
    $('#search').dispatchEvent(new Event('input'));
  }
});
