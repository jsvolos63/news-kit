// `"sideEffects": false` in package.json is what lets the vendoring CLI
// tree-shake a narrowed build (see @jfs/vendor-cli's narrowKitBody: a kit that
// does not declare it is emitted whole). It is an assertion by the kit's
// author that evaluating this module changes nothing observable — so it has to
// stay true as the kit absorbs other kits.
//
// The specific hazard the modal absorption brought in: @jfs/modal-kit installs
// a document `keydown` (Escape stack), a window `popstate` (history sentinel)
// and a window `pagehide` (bfcache scroll unlock). If those were registered at
// module scope, importing the kit would mutate the page and `sideEffects:
// false` would be a lie. They are registered LAZILY by wireGlobals(), on the
// first createModal().open(). This file pins that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(KIT_DIR, 'package.json'), 'utf8'));
const source = readFileSync(join(KIT_DIR, 'index.js'), 'utf8');

test('package.json still declares "sideEffects": false', () => {
  assert.equal(pkg.sideEffects, false);
});

test('importing the kit with NO DOM globals present does not throw', async () => {
  // This test file never installs a DOM shim, so `document` / `window` /
  // `DOMParser` are absent here. A module-scope DOM touch would throw on
  // import.
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.DOMParser, 'undefined');
  const kit = await import('../index.js');
  assert.equal(typeof kit.createModal, 'function');
  assert.equal(typeof kit.escapeHtml, 'function');
});

test('importing the kit registers no event listeners and adds no globals', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const seen = [];
  for (const targetName of ['document', 'window']) {
    const target = targetName === 'document' ? dom.window.document : dom.window;
    const orig = target.addEventListener.bind(target);
    target.addEventListener = (type, ...rest) => {
      seen.push(`${targetName}:${type}`);
      return orig(type, ...rest);
    };
  }
  const beforeGlobals = new Set(Object.keys(globalThis));
  // Fresh evaluation of the module.
  await import(`../index.js?sideEffectProbe=${Date.now()}`);
  assert.deepEqual(seen, [], `module scope registered listeners: ${seen.join(', ')}`);
  const added = Object.keys(globalThis).filter((k) => !beforeGlobals.has(k));
  assert.deepEqual(added, [], `module scope added globals: ${added.join(', ')}`);
});

test('the modal listeners are wired lazily, on the first open()', async () => {
  const { JSDOM } = await import('jsdom');
  const { createModal, _resetModalsForTest } = await import('../index.js');
  _resetModalsForTest();
  const dom = new JSDOM('<!doctype html><html><body><div id="d" hidden></div></body></html>');
  const seen = [];
  for (const [name, target] of [['document', dom.window.document], ['window', dom.window]]) {
    const orig = target.addEventListener.bind(target);
    target.addEventListener = (type, ...rest) => {
      seen.push(`${name}:${type}`);
      return orig(type, ...rest);
    };
  }
  // jsdom wires listeners of its own while a document is driven, so look only
  // at the three the kit installs.
  const ours = () => seen.filter((s) => ['document:keydown', 'window:popstate', 'window:pagehide'].includes(s)).sort();
  const modal = createModal(dom.window.document.getElementById('d'));
  assert.deepEqual(ours(), [], 'createModal() alone must not wire the shared handlers');
  modal.open();
  assert.deepEqual(ours(), ['document:keydown', 'window:pagehide', 'window:popstate']);
  modal.close();
  _resetModalsForTest();
});

test('no top-level statement in index.js is a bare call or assignment', () => {
  // A cheap structural backstop for the two tests above: every top-level
  // statement must be a declaration, an export, or a comment/blank line —
  // never `foo();` or `globalThis.x = …` at column 0.
  const offenders = [];
  // Blank out template-literal bodies first — NEWS_RIVER_CSS / SOURCE_MENU_CSS
  // hold multi-line CSS whose lines are not JavaScript at all.
  const scanned = source.replace(/`(?:[^`\\]|\\[\s\S])*`/g, (lit) => '`' + '\n'.repeat((lit.match(/\n/g) || []).length) + '`');
  scanned.split('\n').forEach((line, i) => {
    if (/^\s*$/.test(line)) return;
    if (/^[ \t)}\]`'"+,.:;?&|*/-]/.test(line)) return; // continuation of a multi-line expression
    if (/^\/\//.test(line)) return;
    if (/^(export|function|const|let|var|class|import|\/\*|\*)/.test(line)) return;
    offenders.push(`${i + 1}: ${line}`);
  });
  assert.deepEqual(offenders, [], `unexpected top-level statements:\n${offenders.join('\n')}`);
});
