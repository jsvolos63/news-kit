// The stylesheets this kit ships as files (0.14.0, FAM-7) and the installers
// standing down when a page links them.
//
// A consumer vendors river.css / source-menu.css with vendor-cli's
// `--format css` and links them from its own origin. That is the one way to
// style the river and the source menu under `style-src 'self'` on an engine
// without constructable stylesheets: the installers' <style> fallback is
// refused there. Every test below fails on 0.13.4, which shipped no file and
// always injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { NEWS_RIVER_CSS, SOURCE_MENU_CSS, ensureNewsRiverStyles, ensureSourceMenuStyles } from '../index.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('river.css and source-menu.css are the exported constants byte for byte, and ship', () => {
  assert.equal(read('river.css'), NEWS_RIVER_CSS);
  assert.equal(read('source-menu.css'), SOURCE_MENU_CSS);
  for (const f of ['river.css', 'source-menu.css']) assert.ok(pkg.files.includes(f), `${f} must be in package.json files`);
  const r = spawnSync(process.execPath, [new URL('tools/css-sync.mjs', root).pathname, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

const page = (head) => new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`).window.document;
const injected = (doc, css) => [...doc.querySelectorAll('style')].filter((s) => s.textContent === css).length
  + (doc.adoptedStyleSheets || []).length;

for (const [label, install, css, token] of [
  ['river', ensureNewsRiverStyles, NEWS_RIVER_CSS, 'river'],
  ['source menu', ensureSourceMenuStyles, SOURCE_MENU_CSS, 'source-menu'],
]) {
  test(`the ${label} installer adds nothing when the page links the kit's stylesheet`, () => {
    const linked = page(`<link rel="stylesheet" href="/css/vendor/x.css" data-news-kit="${token}">`);
    install(linked);
    install(linked);
    assert.equal(injected(linked, css), 0);
    // Another component's link, or a link that is not a stylesheet, does not count.
    const other = page(`<link rel="stylesheet" data-news-kit="${token === 'river' ? 'source-menu' : 'river'}"><link rel="preload" data-news-kit="${token}">`);
    install(other);
    assert.equal(injected(other, css), 1, 'falls back to installing its own copy');
    // Several tokens on one link, and a rel list, both match.
    const multi = page(`<link rel="alternate stylesheet" data-news-kit="river source-menu">`);
    install(multi);
    assert.equal(injected(multi, css), 0);
  });
}
