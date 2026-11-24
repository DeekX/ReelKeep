# ReelKeep extension — privacy

**Nothing leaves your device.** The extension has no analytics, no telemetry,
no remote code, and no server of its own.

- Page metadata (title, Open Graph tags, canonical URL, playback time) is read
  **in the page context** only when you invoke a save, and is handed to **your**
  ReelKeep library (a local server, a folder, or browser storage on your machine).
- The library URL is yours to configure; the default is `http://127.0.0.1:5178`.
  Host permissions are **optional** and requested at the moment of use, for the
  origin you chose — never blanket-granted.
- Saves that cannot reach the library are queued in `chrome.storage.local` on
  your device and retried later. The queue never syncs anywhere.
- `chrome.storage.sync` holds only your library URL preference (browser-account
  sync of that one string, if you enable browser sync; disable it in browser
  settings if you prefer).
- Messages to the library tab are posted with `targetOrigin` pinned to the
  library's own origin, and the library accepts them only from that origin.

Permissions and why: see `store/permissions.md`.
