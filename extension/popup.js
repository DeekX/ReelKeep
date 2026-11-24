/* ReelKeep popup — collects folder/tags/notes, asks the worker to extract and
   hand off. All privileged work lives in background.js. */

const $ = (s) => document.querySelector(s);
const send = (msg) => chrome.runtime.sendMessage(msg);

let page = null;
let tabUrl = '';

async function init() {
  applyI18n();
  const { libUrl } = await chrome.storage.sync.get({ libUrl: 'http://127.0.0.1:5178' });
  $('#libUrl').value = libUrl;
  $('#libUrl').addEventListener('change', () => chrome.storage.sync.set({ libUrl: $('#libUrl').value.trim() }));

  const ex = await send({ cmd: 'extract' });
  page = ex?.page || null;
  tabUrl = ex?.tabUrl || '';
  $('#title').value = page?.title || '';

  const f = await send({ cmd: 'folders' });
  const sel = $('#folder');
  if (f?.folders) {
    // DOM construction only: folder names come from the library, treat as data
    const unfiled = document.createElement('option');
    unfiled.value = '';
    unfiled.textContent = t('folder.unfiled');
    sel.append(unfiled);
    for (const x of f.folders) {
      const o = document.createElement('option');
      o.value = x.name;
      o.textContent = x.name;
      sel.append(o);
    }
  } else {
    sel.hidden = true;
    $('#folderName').hidden = false;
  }

  const q = await send({ cmd: 'queue' });
  if (q?.count) {
    const el = $('#queue');
    el.hidden = false;
    el.textContent = t('ext.queued', { n: q.count });
    el.onclick = async () => {
      const r = await send({ cmd: 'flush' });
      el.textContent = t('ext.flushed', { n: r?.sent || 0 });
      setTimeout(() => (el.hidden = true), 2500);
    };
  }
}

$('#save').addEventListener('click', async () => {
  const btn = $('#save');
  btn.disabled = true;
  const type = $('#type').value;
  const payload = {
    type: type === 'auto' ? 'auto' : type,
    url: tabUrl,
    title: $('#title').value.trim() || page?.title || null,
    description: page?.description || null,
    image: page?.image || null,
    siteName: page?.siteName || null,
    tags: $('#tags').value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12),
    notes: $('#notes').value.trim(),
    folderName: $('#folder').hidden ? $('#folderName').value.trim() : $('#folder').value,
    playbackTime: $('#withTime').checked ? page?.playbackTime ?? null : null,
  };
  const r = await send({ cmd: 'save', payload });
  const status = $('#status');
  if (r?.result === 'queued') {
    status.className = 'err';
    status.textContent = t('ext.failed');
    btn.disabled = false;
    return;
  }
  status.className = 'ok';
  status.textContent = t('ext.saved');
  setTimeout(() => window.close(), 700);
});

init();
