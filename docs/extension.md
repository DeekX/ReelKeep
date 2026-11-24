# ReelKeep browser extension

MV3, Chrome/Edge first, Firefox from the same source. Manual install for now
(`extension/README.md`); store copy prepared in `extension/store/`.

## Architecture

```
popup (form: type/folder/tags/notes/playback-time)
  |  chrome.runtime.sendMessage
background service worker
  |  scripting.executeScript(extractPage)   ← page context, metadata only
  |  handoff:
  |    library tab open  → executeScript(postMessage, targetOrigin = library origin)
  |    no tab            → open library with #reelkeep-save=<payload>
  |    failure           → chrome.storage.local queue, flush later
library app (js/handoff.mjs)
     accepts postMessage only from its own origin; consumes hash once at boot
```

## Security properties

- Permissions: `activeTab`, `scripting`, `contextMenus`, `storage`; host access is
  **optional**, requested per-origin at the moment of use.
- Strict extension CSP (`script-src 'self'`), no remote code, no `eval`, no
  `innerHTML` anywhere in extension scripts (enforced by `test/extension.test.js`).
- Handoff messages are origin-pinned in both directions.
- Queue and preferences stay on-device; see `extension/PRIVACY.md`.

## Verification

- `test/extension.test.js`: manifest validity, permission minimalism, CSP,
  no remote code/eval/innerHTML, local-only popup assets.
- Headless smoke (Edge, which allows `--load-extension`; branded Chrome ignores
  it): extension installs, popup renders with i18n, popup→worker messaging,
  worker storage, and both handoff channels into the running app.
- Store validators (Chrome Web Store / Firefox AMO) are run at submission time;
  the manifest avoids everything they flag (no broad granted hosts, no remote
  code, single purpose documented).

## Firefox notes

`manifest.firefox.json` swaps the service worker for an event page
(`background.scripts`) and adds `browser_specific_settings.gecko`. Everything
else is shared. Build both with `npm run build:ext`.
