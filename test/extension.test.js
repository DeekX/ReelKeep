/* Extension hygiene: manifests are valid MV3 with minimal permissions and a
   strict CSP; no remote code / eval / innerHTML in extension scripts. */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXT = path.join(__dirname, '..', 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

for (const file of ['manifest.json', 'manifest.firefox.json']) {
  test(`${file}: valid MV3, minimal permissions, strict CSP`, () => {
    const m = JSON.parse(read(file));
    assert.equal(m.manifest_version, 3);
    assert.ok(m.name && m.version);
    assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'storage']);
    assert.ok(Array.isArray(m.optional_host_permissions) && m.optional_host_permissions.length);
    assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('<all_urls>'));
    assert.equal(m.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
    assert.ok(m.action.default_popup);
    for (const size of Object.keys(m.icons)) {
      assert.ok(fs.existsSync(path.join(EXT, '..', 'icons', `icon-${size}.png`)), `icon-${size}.png exists`);
    }
  });
}

test('firefox variant carries a gecko id and event-page background', () => {
  const m = JSON.parse(read('manifest.firefox.json'));
  assert.ok(m.browser_specific_settings.gecko.id);
  assert.ok(Array.isArray(m.background.scripts));
});

test('extension scripts contain no eval, remote code, or innerHTML', () => {
  for (const f of ['background.js', 'popup.js']) {
    const src = read(f);
    assert.ok(!/\beval\s*\(/.test(src), f);
    assert.ok(!/new\s+Function\s*\(/.test(src), f);
    assert.ok(!/innerHTML/.test(src), f);
    assert.ok(!/https?:\/\/[^"'\s]*\.js/.test(src), f);
  }
});

test('popup references only local assets', () => {
  const html = read('popup.html');
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(!/^https?:/.test(m[1]), m[1]);
  }
});
