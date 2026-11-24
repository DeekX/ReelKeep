/* i18n key parity — every key in `en` exists in every language, no strays.
   Loads the classic i18n.js in a vm sandbox with minimal browser stubs. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8');
const sandbox = {
  console,
  localStorage: { getItem: () => null, setItem: () => {} },
  navigator: { languages: ['en'] },
  document: { documentElement: {}, querySelectorAll: () => [], dispatchEvent: () => {} },
  CustomEvent: class {
    constructor(type, opts) {
      this.type = type;
      this.detail = opts?.detail;
    }
  },
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const locales = vm.runInContext('I18N_LOCALES', sandbox);
const meta = vm.runInContext('I18N_META', sandbox);

test('all 11 languages are registered', () => {
  assert.deepEqual(Object.keys(locales).sort(), Object.keys(meta).sort());
  assert.equal(Object.keys(locales).length, 11);
});

test('every en key exists in every language, and no stray keys', () => {
  const enKeys = Object.keys(locales.en).sort();
  assert.ok(enKeys.length > 100, 'en dictionary looks suspiciously small');
  for (const [lang, dict] of Object.entries(locales)) {
    if (lang === 'en') continue;
    const keys = Object.keys(dict).sort();
    const missing = enKeys.filter((k) => !(k in dict));
    const stray = keys.filter((k) => !(k in locales.en));
    assert.deepEqual(missing, [], `${lang} missing keys`);
    assert.deepEqual(stray, [], `${lang} stray keys`);
  }
});

test('translations use only known placeholders (omission is allowed, e.g. ar singular)', () => {
  const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, enVal] of Object.entries(locales.en)) {
    const allowed = new Set(ph(enVal));
    for (const [lang, dict] of Object.entries(locales)) {
      if (lang === 'en' || !(key in dict)) continue;
      const invented = ph(dict[key]).filter((p) => !allowed.has(p));
      assert.deepEqual(invented, [], `${lang}.${key} invented placeholders`);
    }
  }
});
