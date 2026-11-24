/* ReelKeep extension — MV3 service worker.
   Minimal permissions: activeTab + scripting + contextMenus + storage, with
   optional host permissions requested at the moment of use. No remote code,
   no eval, no telemetry. Saves hand off to the library tab (postMessage with
   an explicit origin) or open the library with a hash payload; failures queue
   locally and flush later. */

const DEFAULT_LIB = 'http://127.0.0.1:5178';
const QUEUE_KEY = 'reelkeep-queue';

/* Runs in the page context via scripting.executeScript — reads metadata only. */
function extractPage() {
  const meta = (attr, value) =>
    document.querySelector(`meta[${attr}="${value}"]`)?.content?.trim() || null;
  const video = document.querySelector('video');
  const audio = document.querySelector('audio');
  const player = video || audio;
  const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
  return {
    title: meta('property', 'og:title') || meta('name', 'twitter:title') || document.title || null,
    description: meta('property', 'og:description') || meta('name', 'description') || null,
    image: meta('property', 'og:image') || meta('name', 'twitter:image') || null,
    siteName: meta('property', 'og:site_name') || null,
    ogType: meta('property', 'og:type') || null,
    canonical,
    url: location.href,
    playbackTime: player && !player.paused ? Math.floor(player.currentTime) : player ? Math.floor(player.currentTime) : null,
    hasVideo: !!video,
    hasAudio: !!audio,
    selection: String(window.getSelection?.() || '').slice(0, 20000) || null,
  };
}

function postToTab(payload) {
  // injected into the library tab; targetOrigin pins the message to that origin
  window.postMessage({ from: 'reelkeep-ext', payload }, location.origin);
}

async function settings() {
  const s = await chrome.storage.sync.get({ libUrl: DEFAULT_LIB });
  return s.libUrl || DEFAULT_LIB;
}

async function queuePush(payload) {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  queue.push(payload);
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-50) });
}

async function queueFlush() {
  const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
  if (!queue.length) return 0;
  const left = [];
  let sent = 0;
  for (const payload of queue) {
    try {
      await handoff(payload, { request: false });
      sent++;
    } catch {
      left.push(payload);
    }
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: left });
  return sent;
}

/** Deliver a payload to the library: existing tab via postMessage, else open one. */
async function handoff(payload, { request = true } = {}) {
  const libUrl = await settings();
  const origin = new URL(libUrl).origin;
  if (request) {
    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!ok) throw new Error('permission denied');
  } else if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) {
    throw new Error('permission missing');
  }
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (tabs.length) {
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: postToTab, args: [payload] });
    return 'tab';
  }
  await chrome.tabs.create({ url: `${libUrl.replace(/\/$/, '')}/#reelkeep-save=${encodeURIComponent(JSON.stringify(payload))}` });
  return 'opened';
}

async function savePayload(payload) {
  try {
    return await handoff(payload);
  } catch (err) {
    await queuePush(payload);
    return 'queued';
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'rk-page', title: 'Save page to ReelKeep', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'rk-link', title: 'Save link to ReelKeep', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'rk-image', title: 'Save image to ReelKeep', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'rk-selection', title: 'Save selection as a ReelKeep note', contexts: ['selection'] });
  });
  queueFlush().catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'rk-selection') {
      await savePayload({ type: 'note', body: info.selectionText || '', title: (info.selectionText || 'Note').split('\n')[0].slice(0, 80) });
      return;
    }
    const url = info.menuItemId === 'rk-link' ? info.linkUrl : info.menuItemId === 'rk-image' ? info.srcUrl : info.pageUrl || tab?.url;
    let page = null;
    if (tab?.id != null && info.menuItemId === 'rk-page') {
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
        page = result;
      } catch {
        /* page forbids injection: fall back to the bare URL */
      }
    }
    await savePayload({
      type: info.menuItemId === 'rk-image' ? 'image' : 'auto',
      url,
      title: page?.title || null,
      description: page?.description || null,
      image: info.menuItemId === 'rk-image' ? info.srcUrl : page?.image || null,
      siteName: page?.siteName || null,
      playbackTime: null,
    });
  } catch {
    /* menus must never throw */
  }
});

/* Popup asks the worker to do the privileged parts. */
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  (async () => {
    if (msg?.cmd === 'extract') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return respond({ error: 'no tab' });
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage });
        respond({ page: result, tabUrl: tab.url });
      } catch (err) {
        respond({ page: null, tabUrl: tab.url, error: String(err?.message || err) });
      }
      return;
    }
    if (msg?.cmd === 'save') {
      respond({ result: await savePayload(msg.payload) });
      return;
    }
    if (msg?.cmd === 'flush') {
      respond({ sent: await queueFlush() });
      return;
    }
    if (msg?.cmd === 'queue') {
      const { [QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(QUEUE_KEY);
      respond({ count: queue.length });
      return;
    }
    if (msg?.cmd === 'folders') {
      try {
        const libUrl = await settings();
        const res = await fetch(`${libUrl.replace(/\/$/, '')}/api/library`);
        const { library } = await res.json();
        respond({ folders: (library.folders || []).map((f) => ({ id: f.id, name: f.name })) });
      } catch {
        respond({ folders: null });
      }
      return;
    }
    respond({ error: 'unknown command' });
  })();
  return true; // async response
});
