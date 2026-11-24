/* ReelKeep shared helpers — pure, DOM-free at import time (node-testable). */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function fmtTime(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** "19:42" | "1:02:03" | "90" | "19m42s" -> seconds */
export function parseTime(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const hm = s.match(/^(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+(?:\.\d+)?)\s*s?)?$/);
  if (hm && (hm[1] || hm[2] || hm[3])) return (+hm[1] || 0) * 3600 + (+hm[2] || 0) * 60 + parseFloat(hm[3] || 0);
  const parts = s.split(':').filter((p) => p !== '');
  if (parts.length >= 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
    return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  }
  return null;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function parseUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    try {
      return new URL('https://' + s.replace(/^\/+/, ''));
    } catch {
      return null;
    }
  }
}

export const assetUrl = (t) => (!t ? null : /^(https?:|data:|blob:)/i.test(t) ? t : '/' + t.replace(/^\/+/, ''));

export function debounce(fn, ms = 450) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.now = (...args) => {
    clearTimeout(t);
    return fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

export const seekPromise = (video, t) =>
  new Promise((resolve) => {
    const finish = () => {
      video.removeEventListener('seeked', finish);
      resolve();
    };
    video.addEventListener('seeked', finish);
    try {
      video.currentTime = Math.max(0, t);
    } catch {
      finish();
    }
    setTimeout(finish, 9000);
  });

export function drawFrame(video, canvas, quality = 0.86) {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = Math.min(1920, w);
  canvas.height = Math.round((canvas.width * h) / w);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** dataURL → Blob (for storage adapters that take binary payloads) */
export function dataUrlToBlob(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error('not a data URL');
  const mime = m[1] || 'application/octet-stream';
  const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
  return new Blob([bytes], { type: mime });
}

export const fmtBytes = (n) => {
  if (!isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
};
