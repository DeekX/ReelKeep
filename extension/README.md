# ReelKeep browser extension (MV3)

One-click save to your library. Chrome/Edge first; Firefox builds from the same
source. **Manual install for now** — store listing copy is prepared in `store/`.

## Build

```sh
node scripts/gen-icons.mjs       # once, if icons/ is missing
node scripts/build-extension.mjs # writes dist/extension-chrome and dist/extension-firefox
```

## Install (Chrome / Edge)

1. `chrome://extensions` → enable *Developer mode*.
2. *Load unpacked* → select `dist/extension-chrome`.

## Install (Firefox)

1. `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…*.
2. Select `dist/extension-firefox/manifest.json`.

## Use

- Set your library URL in the popup's *Library URL* field (default
  `http://127.0.0.1:5178`; a hosted folder-mode app URL works too).
- Toolbar button: form with type/folder/tags/notes and an optional
  "include current playback time" checkbox.
- Right-click: save page, link, image, or selection (as a note).
- The first save to an origin asks for permission to reach **your** library;
  declining queues the save locally instead.

## How the handoff works

Existing library tab → `postMessage` with `targetOrigin` pinned to the library
origin; the library accepts only messages from its own origin. No tab open →
the library is opened with a `#reelkeep-save=` hash payload, consumed once at
boot. Failures queue in `chrome.storage.local` and flush on next use.

## Files

| File | Role |
| --- | --- |
| `manifest.json` / `manifest.firefox.json` | MV3 manifests (service worker / event page) |
| `background.js` | context menus, extraction, handoff, queue |
| `popup.html/js/css` | the save form (screening-room identity) |
| `PRIVACY.md` | no data leaves the device |
| `store/` | listing copy + permission justifications |

`i18n.js` and `icons/` are copied in by the build script; popup strings live in
the shared dictionaries (`ext.*` keys, all 11 languages).
