/* ReelKeep shared UI helpers — toasts, confirm dialog, locale-aware dates.
   i18n comes from the classic i18n.js globals (loaded before the modules). */

import { $, esc } from './util.mjs';

export function toast(msg, kind = '', ms = 3400, action = null) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const span = document.createElement('span');
  span.textContent = msg;
  el.append(span);
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-act';
    btn.textContent = action.label;
    btn.onclick = (e) => {
      e.stopPropagation();
      el.remove();
      action.fn();
    };
    el.append(btn);
  }
  el.onclick = () => el.remove();
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function confirmBox(title, text) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#cfTitle').textContent = title;
    $('#cfText').textContent = text;
    let answer = false;
    $('#cfOk').onclick = () => {
      answer = true;
      dlg.close();
    };
    dlg.onclose = () => {
      dlg.onclose = null;
      resolve(answer);
    };
    dlg.showModal();
  });
}

export const relDate = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const days = (Date.now() - d) / 86400000;
  if (days < 1) return t('date.today');
  if (days < 2) return t('date.yesterday');
  if (days < 30) return t('date.days', { n: Math.floor(days) });
  return d.toLocaleDateString(i18nTag(), { day: 'numeric', month: 'short', year: days > 365 ? 'numeric' : undefined });
};

export { esc };
