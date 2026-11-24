# i18n status

11 languages: en, ar, ru, fr, de, es, zh, ja, ko, hi, tr. `test/i18n.test.js`
enforces key parity (every `en` key in every language, no strays) and checks
that translations never invent placeholders.

## Review status

- `en` — author language, source of truth.
- `ar` — reviewed for RTL layout; singular forms intentionally omit `{n}`
  (e.g. `count.one` = "فيديو واحد" / "عنصر واحد").
- `ru, fr, de, es, zh, ja, ko, hi, tr` — the universal-library strings
  (`I18N_UNIVERSAL` block in `i18n.js`, added in v2.0.0) are **machine-quality**
  and await native-speaker review. Earlier blocks were reviewed iteratively
  during v1.3–v1.5.

Contributions: copy the `en` values, translate, keep `{placeholders}` intact
(omitting one is allowed when the grammar makes it redundant, as in Arabic
singulars). Run `npm test` — the parity suite will catch missing or stray keys.
