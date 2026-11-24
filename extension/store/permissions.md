# Permission justifications (store listing)

| Permission | Why it is needed | Why it is minimal |
| --- | --- | --- |
| `activeTab` | Read the current tab's URL/metadata when the user clicks Save | Granted per-invocation by the user's click; no persistent access |
| `scripting` | Inject the metadata extractor into the active tab, and the handoff `postMessage` into the library tab | Only two fixed functions, no remote code; library injection requires the optional host permission for the user's own library origin |
| `contextMenus` | "Save page / link / image / selection to ReelKeep" entries | Four static entries, no dynamic menus |
| `storage` | Remember the library URL; queue undelivered saves locally | Local queue + one preference; no browsing history stored |
| optional host permissions (`http://127.0.0.1/*`, `http://localhost/*`, `https://*/*`) | Reach the user's own library (local server or hosted folder-mode app) | **Optional**: requested at the moment of use for the chosen origin only; the user can decline and saves queue instead |

Not requested: `tabs`, `history`, `webRequest`, `cookies`, `<all_urls>` as a
granted permission, or any broad host access at install time.
