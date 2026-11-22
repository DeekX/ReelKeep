# Reelkeep — UI/UX handoff brief

Handoff document for a UI/UX agent. It describes the product, every surface that exists,
the **prescribed visual identity**, the hard contracts (technical, i18n, RTL, a11y), and
how to verify your work. Read it fully before touching `styles.css` or `index.html`.

Repository: `https://github.com/DeekX/ReelKeep` · version 1.4.0 · license MIT.

> **Why this brief is prescriptive.** An earlier revision listed only constraints
> ("dark, restrained, one accent, no gradients") plus a token table. Every agent given
> that recipe converged on the same generic AI-dashboard look. Constraints alone do not
> produce identity. §2 below therefore *prescribes* the identity decisions — corner
> language, type voice, density, depth, motion, brand lockup. Execute them; do not
> substitute your own house style.

---

## 1. What the product is

Reelkeep is a **local-first personal video library**. You paste any video link
(YouTube, Vimeo, TikTok, Twitch, X, Facebook, Instagram, Loom, Wistia, Streamable,
Rutube, Dailymotion, Internet Archive, or any page/direct file), watch it in a unified
player, organise it into folders and tags, and give each entry the cover you want —
including frame-accurate thumbnails captured from video files. Everything persists in
one plain JSON file (`data/videos.json`).

Selling points: **zero dependencies, no build step, no database**. One Node server
(`server.js`, Node 18+) plus vanilla HTML/CSS/JS. It also runs without the server
(browser-storage fallback) and as a static GitHub Pages demo.

Primary user: one person (or a trusted household/LAN) curating hundreds to thousands of
saved videos. Long browsing/organising sessions. Density matters; so does calm.

### Run it

```sh
node server.js          # or npm start  → http://127.0.0.1:5178
npm test                # node:test smoke suite, zero dependencies
npm run screenshot      # regenerates docs/screenshot-*.png (Node 22+, Chrome installed)
```

First run seeds `data/videos.example.json` (5 videos, 2 folders) so every surface has
real content. Open `index.html` directly (file://) for the degraded browser-storage mode.

### File map

| File | Role |
| --- | --- |
| `index.html` | gallery markup: all dialogs, bars, icon `<symbol>` sprite |
| `styles.css` | **the entire visual layer** (single file, custom properties) |
| `app.js` | all behaviour: state, template-string rendering, events, drag/drop |
| `player.html` | minimal in-iframe native `<video>` player for file sources |
| `i18n.js` | 11 language dictionaries + `t()` / `applyI18n()` / `setLocale()` runtime |
| `server.js` | static allowlist + JSON store + metadata enrich + media proxy + uploads |
| `docs/screenshot-*.png` | current-state captures (§6) |
| `scripts/screenshot.mjs` | headless-Chrome capture tool for those screenshots |

---

## 2. Prescribed identity: "screening room"

The product is a personal cinema archive, not a SaaS dashboard. The visual language is
a **screening-room console**: contact-sheet grid, ledger list, slate metadata, broadcast
blue. Execute these decisions exactly:

1. **Corner language:** squared, not pillowy. Cards/panels `8px`, controls/chips/inputs
   `4px`, dialogs `8px`. **No pill shapes anywhere** except the circular status dot and
   the play disc. No `border-radius: 999px`.
2. **Depth:** flat. Hairline `1px` borders on surfaces; **no shadows on cards or rows**;
   shadows only on floating layers (dialogs, toasts). Hover = accent-tinted border +
   background colour shift (clear click affordance, still flat). **No lift
   (`translateY`), no scale, no zoom on thumbnails.**
3. **Type voice:** two registers. Sans (system stack) for titles and prose; **monospace
   for everything technical**: brand wordmark, counts, durations, timestamps, hosts,
   tags, folder badges, kinds, kbd, footer, micro-labels. Micro-labels are uppercase
   mono 10–11px with 0.08–0.12em tracking. Tabular numerals on all numeric slates.
4. **Brand lockup:** small squared hairline tile with accent glyph + `REELKEEP`
   letterspaced uppercase mono wordmark + mono count beneath. No rounded gradient tile,
   no sans logotype.
5. **Accent:** one broadcast blue (`--accent: #58a6ff`), used sparingly: primary action
   (dark text on blue for contrast), active filters/toggles, focus, selection, drag
   targets. **Not** startup indigo/violet. Status hues stay separate: green = live
   storage, amber = browser-only, red = destructive.
6. **Grid = contact sheet:** framed 16:9 thumbs flush to the card edge with a hairline
   under them; slate strip below (sans title, mono meta row with squared tag chips).
   Badge = mono micro-label top-start; duration stamp = mono tabular bottom-end.
7. **List = ledger:** full-width hairline-separated rows, no card boxes, small framed
   thumb at row start, two-line title (15px) + two-line note + mono meta — the ledger
   keeps the old list view's information richness. Row hover = flat background tint +
   accent-tinted separator. Selection = inset accent rule at row start.
8. **Section heads = slates:** full-span rule with uppercase mono label left, mono count
   right (group-by-source, and the empty-state top rule).
9. **Empty states = editorial:** left-aligned copy under a top hairline rule, small dim
   icon, restrained CTA; a settled block (max-width 480px) centred in the free space
   with left-aligned content. Never a centred icon-hero.
10. **Motion signature:** colour/border/opacity only, `120ms` ease-out (`--speed`).
    Entrance = opacity fade only. Dialogs fade in. `prefers-reduced-motion` kills all.
11. **Focus:** real `outline: 2px solid accent; outline-offset: 2px` (inset on cards and
    chips so `overflow: hidden` cannot clip it). Never a clipped box-shadow ring.
12. **Forbidden (owner's standing rule):** gradients, glassmorphism/`backdrop-filter`,
    emoji in UI, decorative clutter, neon multi-accent, hero typography in app chrome,
    and the generic AI-dashboard palette (indigo `#5e6ad2`-family on `#0d1117` with
    pillowy cards). If a change makes it look like a template, revert it.

Dark theme only. A light theme is a stretch goal only if it obeys the same identity.

---

## 3. Current tokens (`styles.css :root`)

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#080a0d` | page background |
| `--bg-2` | `#0d1117` | inputs, inset wells, ledger hover base |
| `--panel` | `#10141a` | cards, dialogs |
| `--panel-2` | `#161b22` | raised controls, hover fills |
| `--line` | `#262c36` | control borders |
| `--line-soft` | `#1b2027` | hairlines: rows, sections, card edges |
| `--text` | `#e6edf3` | primary text |
| `--muted` | `#9198a1` | secondary text |
| `--dim` | `#6e7681` | tertiary/meta |
| `--accent` | `#58a6ff` | the single accent |
| `--accent-soft` | `#a5d6ff` | accent-tinted text |
| `--danger` | `#ff7b72` | destructive |
| `--ok` | `#3fb950` | live-storage dot |
| `--warn` | `#d29922` | browser-only dot |
| `--radius` / `--radius-s` | `8px` / `4px` | surfaces / controls |
| `--shadow` | `0 16px 40px -18px rgba(0,0,0,.9)` | floating layers only |
| `--font` | system sans + Noto fallbacks (ar/hi/zh/ja/ko) | titles, prose |
| `--mono` | `ui-monospace, "Cascadia Mono", Consolas, "Noto Sans Mono", monospace` | slates |
| `--speed` | `120ms` | all transitions |

Every colour/radius/shadow must come from tokens; never hardcode mid-rule.
Type scale: body 13, card title 13 (list 15), dialog h2 15, micro 10–11 mono, meta slates
11 mono in `--muted` (not `--dim` — legibility), help 11.5.

---

## 4. Surface inventory (everything that must keep working)

### 4.1 Gallery chrome
- **Topbar** (sticky, single row, wraps ≤700px): brand lockup; search (left-anchored,
  icon + `/` kbd); tools right: select-mode (`#selectBtn`), group-by-source (`#groupBtn`),
  grid/list segmented (`#viewGrid`/`#viewList`), sort/source/language custom-chevron
  `<select>`s (`#sortSel`, `#providerSel`, `#langSel`), primary **Add video** (`#addBtn`).
- **Folder bar** (`#folderbar`): squared chips *All videos*, *Unfiled*, folders (icon +
  name + mono count), dashed *New folder*. **Drop targets**: while dragging, all folder
  chips outline dashed (`body.drag-ids`); hovered chip = `.hot` solid accent.
  Double-click renames.
- **Folder action bar** (`#folderActions`, folder open): icon, name, mono count, spacer,
  **Empty folder** / **Rename** / **Delete folder** (danger).
- **Selection bar** (`#selectbar`): mono "N selected", primary **Move to folder…**, **Done**.
- **Tag bar** (`#tagbar`): squared `#tag` chips with mono counts, multi-select (`.on`).
- **Grid** (`#grid`): `repeat(auto-fill, minmax(264px, 1fr))`, gap 10–16px. List mode
  (`.grid.list`) = ledger (§2.7). Group mode inserts full-span `.group-head` slates.
- **Card** (`.card`): framed thumb + hairline; mono badge top-start; mono stamp
  bottom-end; hover play scrim + flat accent disc; hover edit/delete tiles
  (`.card-actions`); select-mode checkbox tile (`.card-select`) + `.selected` inset ring;
  body: 2-line title (dbl-click inline rename `.rename`; search hits `<mark>`), notes
  (list only), mono meta row: `.fold` folder badge, squared `.t` tags, host, rel date,
  start time. Entrance: opacity fade. Hover: colour only.
- **Empty states** (`#empty`): editorial per §2.9; two variants (empty / no matches);
  stays vertically centred in free space.
- **Dropzone** (`#dropzone`): full-screen dashed accent overlay, uppercase mono copy.
- **Footer** (`.libfoot`): mono; storage dot (`.dot.live`/`.dot.local`), library path in
  `code`, tip line.

### 4.2 Player lightbox (`#lightbox`, full-viewport, opaque background)
Bar: close, editable title, tools (fit, fullscreen, thumbnail, edit, open original).
Stage: iframe + edge `.lb-nav` (hover-revealed, RTL-flipped arrows) + `.lb-hint`.
Foot: mono meta chips + remember-start switch (file sources). **Fit mode**
(`.lightbox.fit`) removes padding, fades chrome on hover/focus. Do not rely on
`::backdrop` for the lightbox.

### 4.3 Dialogs (native `<dialog>`, 8px radius, hairline head/foot rules)
- **Add** (`#addDialog`): tabs Link/Embed/Upload; panels; live preview (`.preview-thumb`
  + fields + use-og switch); status line (`#addStatus` busy/ok/err); Cancel / Add.
- **Edit** (`#editDialog`): `.preview-thumb.lg` (image **absolutely fills**, object-fit
  cover — keep), fields, `<details class="adv">` (mono uppercase summary), thumb action
  row, Delete/Cancel/Save.
- **Thumbnail picker** (`#thumbDialog`, wide): scrubber panel (video, range, time input,
  ±1s, canvas + `.canvas-note`, use-frame, also-start switch) / provider `.frame-grid` /
  blocked panel; footer upload / URL field / Use URL / reset.
- **Move** (`#moveDialog`): `.move-opt` list (`.on` chosen; per-row rename/delete spans),
  new-folder input + Create, Cancel / Move.
- **Confirm** (`#confirmDialog`, tiny): title/text/Cancel/Delete.
- **Toasts** (`#toasts`): bottom-centre above footer, 6px radius, ok/err border hues,
  fade-in, click dismiss.

### 4.4 File player (`player.html`)
Black stage, native `<video controls>`, centred error overlay. Inherits locale/dir.
Keep austere.

---

## 5. Contracts you must not break

### 5.1 JS hooks (restyle freely, rename never)
- IDs: `count, search, sortSel, providerSel, langSel, addBtn, selectBtn, groupBtn,
  viewGrid, viewList, folderbar, folderActions, faName, faCount, faEmpty, faRename,
  faDelete, selectbar, selCount, selMove, selClear, tagbar, grid, empty, emptyTitle,
  emptyText, dropzone, lightbox, lbFrame, lbTitle, lbHint, lbMeta, lbRemember,
  addDialog, addForm, addUrl, addEmbed, addFile, dropField, dropLabel, upProgress,
  addPreview, pvThumb, pvTitle, pvTags, pvStart, pvNotes, pvUseOg, addStatus, addSave,
  editDialog, editForm, edThumb, edTitle, edTags, edStart, edNotes, edUrl, edEmbed,
  edKind, edFrame, edImage, edImageUrl, edDefault, edDelete, thumbDialog, tpFrame,
  tpVideo, tpCanvas, tpTime, tpRange, tpOut, tpAlsoStart, tpStepB, tpStepF, tpGrab,
  tpProvider, tpFrames, tpBlocked, tpUpload, tpUrl, tpUseUrl, tpReset, moveDialog,
  moveForm, mvList, mvNew, mvCreate, confirmDialog, cfTitle, cfText, cfOk, toasts,
  backend, tip`.
- Data attributes: `data-act` (edit/del/rename/select), `data-lb`
  (close/fit/full/thumb/edit/open/prev/next), `data-tab`/`data-panel` (link/embed/upload),
  `data-folder`, `data-newfolder`, `data-mv`, `data-mv-edit`, `data-mv-del`, `data-close`,
  `data-open="add"`, `data-id` on cards.
- State classes: `.on`, `.hot`, `.dragging`, `.selected`, `.selecting` (on `#grid`),
  `.list` (on `#grid`), `.fit` (on `#lightbox`), `.live`/`.local` (on `#backend`),
  `.ok`/`.err`/`.busy`, `body.drag-ids`.
- `[hidden] { display: none !important; }` must stay.
- Icon sprite `<symbol id="i-*">` (24×24, stroke 2, round caps): keep ids; fit = inward
  arrows, fullscreen = outward arrows (must stay distinct).

### 5.2 i18n / RTL
- 11 locales: en, ar, ru, fr, de, es, zh-Hans, ja, ko, hi, tr. All UI text via `t()` or
  `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`, `data-i18n-html`. **Never
  hardcode user-facing strings**; new copy needs keys in all 11 dictionaries.
- Arabic sets `dir="rtl"` on `<html>`. Use **logical properties** throughout
  (`inset-inline-*`, `margin-inline`, `padding-inline`, logical border radii,
  `text-align: start`). Flex/grid mirror automatically; `[dir="rtl"] .lb-nav svg` flips
  arrows; the select chevron and ledger thumb margin have explicit RTL overrides — keep
  them. Verify every change in en **and** ar.
- de/ru/fr strings run long: no fixed-width text boxes; wrap or ellipsis by design.

### 5.3 Accessibility & input
- Native `<dialog>` + `showModal()`; `aria-pressed` toggles; `aria-label` icon buttons
  and cards; `aria-live` grid; outline-based `:focus-visible` (§2.11).
- Keyboard: `/` search · `N` add · `V` view · `G` group · `Enter` open/select ·
  `Esc` close/exit selection · `←`/`→` player nav · `F` fullscreen · `K` play/pause
  (file player) · double-click rename (card title, player title, folder chip).
- `prefers-reduced-motion` kill-switch stays.
- Drag/drop: cards draggable; folder chips accept drops with the highlight contract;
  external file/link drop shows `#dropzone`; dragging a selected card moves the selection.

### 5.4 Technical
- **No dependencies, no build step, no framework, no preprocessor, no webfont downloads,
  no external assets.** Single plain CSS file; vanilla JS.
- Works from `file://` and GitHub Pages.
- Static allowlist serves only `index.html, player.html, app.js, styles.css, i18n.js` +
  `thumbnails/` + `videos/`. New asset files would need `PUBLIC_FILES` (server.js), the
  Pages workflow copy list and the test copy list updated — prefer adding none.
- Responsive: ≤900px scrubber/preview stack; ≤700px topbar reflow (search full row),
  ledger rows stack back into cards, footer tip hides.

---

## 6. Current-state reference captures

Regenerate with `npm run screenshot` (server running; Node 22+; Chrome/Edge;
`CHROME_PATH`/`REELKEEP_URL` overrides). Inspect before designing:

| File | Shows |
| --- | --- |
| `docs/screenshot-grid.png` | contact-sheet grid, bars, slates (en) |
| `docs/screenshot-list.png` | ledger list view |
| `docs/screenshot-player.png` | lightbox + native file-player controls, paused mid-film |
| `docs/screenshot-frames.png` | frame-accurate thumbnail picker |
| `docs/screenshot-groups.png` | group-by-source slates |
| `docs/screenshot-move.png` | selection mode + move dialog |
| `docs/screenshot-rtl.png` | full Arabic RTL gallery |

---

## 7. Remaining friction (craft opportunities)

Verified weak spots left after the 1.4.0 identity pass:

1. **Loading states:** no skeletons; covers pop in over a static placeholder well.
2. **Topbar at 700–1100px:** seven controls still wrap; consider an overflow menu for
   sort/source/language (keep keyboard a11y and the selects' ids).
3. **Card meta row** wraps to two lines with long folder names + tags; consider hiding
   overflow tags behind a `+n` slate.
4. **Provider frame grid** tiles have no loading/failed state beyond removal.
5. **Fit mode** has no affordance hinting the hidden chrome exists.
6. **No visual distinction** between uploaded local files and remote links beyond badge
   text (a mono `LOCAL` slate would fit the identity).
7. **Toast stack** can cover the footer at very short viewports.
8. List-view **column alignment** is per-row flex, not a true shared grid; long titles
   and meta don't align across rows. A shared column template would tighten the ledger.

Fix within the constraints; document anything deliberately left.

---

## 8. Deliverables & acceptance

1. Revised `styles.css` obeying §2–§3 (tokenised, logical properties, no forbidden
   decoration). Minimal `index.html` changes only where structure genuinely improves;
   preserve every §5.1 hook and `data-i18n*` attribute.
2. New copy: keys in **all 11** dictionaries.
3. `npm test` green (9 tests); `node --check app.js server.js i18n.js` clean.
4. Regenerated screenshots (all seven, en + RTL), visually inspected — especially RTL
   and ≤700px reflow.
5. Manual pass: keyboard map, select mode + drag highlights, all five dialogs, fit mode,
   empty states, file:// mode, Arabic.
6. `CHANGELOG.md` entry under a new version heading; bump `package.json` (semver).
7. No new runtime dependencies, no build step, no network asset fetches.

Out of scope: behaviour/features/API changes, rewriting `app.js` rendering. Surgical JS
changes only if a visual improvement truly requires one; call them out in the changelog.
