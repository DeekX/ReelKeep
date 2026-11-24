/* ReelKeep in-iframe file player — classic script (shares i18n.js globals).
   Extracted from player.html so the server CSP can forbid inline scripts. */
'use strict';

const q = new URLSearchParams(location.search);
const src = q.get('src');
const start = Number(q.get('t') || 0);
const auto = q.get('autoplay') !== '0';
const v = document.getElementById('v');
const post = (msg) => parent.postMessage({ from: 'vg-player', ...msg }, parentOrigin());

// only our own app origin may receive playback telemetry
function parentOrigin() {
  try {
    return document.referrer ? new URL(document.referrer).origin : location.origin;
  } catch {
    return location.origin;
  }
}

if (!src) {
  const box = document.createElement('div');
  box.className = 'err';
  box.textContent = t('player.nosrc');
  document.body.append(box);
} else {
  v.src = src;
  if (auto) v.play().catch(() => {});
  if (start > 0) {
    v.addEventListener(
      'loadedmetadata',
      () => {
        try {
          v.currentTime = start;
        } catch (e) {
          /* seek refused: start at 0, honestly */
        }
      },
      { once: true },
    );
  }
  let last = 0;
  v.addEventListener('timeupdate', () => {
    if (Math.abs(v.currentTime - last) >= 1) {
      last = v.currentTime;
      post({ type: 'time', t: v.currentTime, paused: v.paused });
    }
  });
  v.addEventListener('loadedmetadata', () => post({ type: 'meta', duration: v.duration }));
  v.addEventListener('error', () => {
    post({ type: 'error' });
    const box = document.createElement('div');
    box.className = 'err';
    box.textContent = t('player.format');
    document.body.append(box);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'k') v.paused ? v.play() : v.pause();
    if (e.key === 'f') (document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen());
  });
}
