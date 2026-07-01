// DOM-dependent sanitizeHtml tests. jsdom (devDependency only — index.js
// imports nothing) is installed on globalThis BEFORE the kit is imported so
// sanitizeHtml resolves document/DOMParser at call time, mirroring a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;

const { sanitizeHtml } = await import('../index.js');

function htmlOf(frag) {
  const div = window.document.createElement('div');
  div.appendChild(frag);
  return div.innerHTML;
}

test('keeps allowlisted tags and drops blocked subtrees entirely', () => {
  const out = htmlOf(sanitizeHtml('<p>keep</p><script>alert(1)</script><style>p{}</style>'));
  assert.equal(out, '<p>keep</p>');
});

test('unwraps unknown tags but keeps their cleaned children', () => {
  const out = htmlOf(sanitizeHtml('<section><article><p>prose</p> tail</article></section>'));
  assert.equal(out, '<p>prose</p> tail');
});

test('blocked subtree removal beats unwrapping (script inside div)', () => {
  const out = htmlOf(sanitizeHtml('<div><script>alert(1)</script><em>ok</em></div>'));
  assert.equal(out, '<div><em>ok</em></div>');
});

test('drops event handlers and non-allowlisted attributes', () => {
  const out = htmlOf(sanitizeHtml('<p onclick="alert(1)" class="x" data-y="z">t</p>'));
  assert.equal(out, '<p>t</p>');
});

test('keeps safe hrefs, decorates real links, drops dangerous hrefs', () => {
  const safe = htmlOf(sanitizeHtml('<a href="https://example.com/a">x</a>'));
  assert.match(safe, /href="https:\/\/example\.com\/a"/);
  assert.match(safe, /target="_blank"/);
  assert.match(safe, /rel="noopener noreferrer"/);

  const unsafe = htmlOf(sanitizeHtml('<a href="javascript:alert(1)">x</a>'));
  assert.ok(!unsafe.includes('javascript:'), 'dangerous href removed');
  assert.ok(!unsafe.includes('target='), 'hrefless anchor not decorated');
  assert.match(unsafe, /<a>x<\/a>/);
});

test('img with unsafe or missing src is unwrapped by default', () => {
  assert.equal(htmlOf(sanitizeHtml('<img src="javascript:alert(1)">')), '');
  assert.equal(htmlOf(sanitizeHtml('<img>')), '');
  const kept = htmlOf(sanitizeHtml('<img src="https://example.com/x.png">'));
  assert.match(kept, /src="https:\/\/example\.com\/x\.png"/);
  assert.match(kept, /alt=""/); // decorative default when alt is allowlisted
});

test('requireImageSrc:false keeps a src-less img; defaultAlt:false keeps authored alts only', () => {
  const kept = htmlOf(sanitizeHtml('<img alt="chart">', { requireImageSrc: false, defaultAlt: false }));
  assert.equal(kept, '<img alt="chart">');
});

test('srcset survives only when every candidate is safe', () => {
  const attrs = { IMG: ['src', 'alt', 'srcset'] };
  const ok = htmlOf(sanitizeHtml(
    '<img src="https://e.com/a.jpg" srcset="https://e.com/a.jpg 1x, https://e.com/b.jpg 2x">', { attrs },
  ));
  assert.match(ok, /srcset="/);
  const bad = htmlOf(sanitizeHtml(
    '<img src="https://e.com/a.jpg" srcset="javascript:alert(1) 1x">', { attrs },
  ));
  assert.ok(!bad.includes('srcset'), 'unsafe srcset dropped');
});

test('lazyImages option stamps loading="lazy"', () => {
  const out = htmlOf(sanitizeHtml('<img src="https://e.com/a.jpg">', { lazyImages: true }));
  assert.match(out, /loading="lazy"/);
});

test('globalAttrs allows benign attrs everywhere but never URL/event names', () => {
  const out = htmlOf(sanitizeHtml('<p dir="rtl" lang="ar" onclick="x()" href="/a">t</p>', {
    globalAttrs: ['dir', 'lang', 'onclick', 'href'],
  }));
  assert.match(out, /dir="rtl"/);
  assert.match(out, /lang="ar"/);
  assert.ok(!out.includes('onclick'), 'event handler rejected even when allowlisted');
  assert.ok(!/href=/.test(out), 'URL attr rejected outside per-tag validation');
});

test('foreign content (svg) is dropped with its subtree, not unwrapped', () => {
  // Unwrapping SVG children into an HTML sink could resurrect HTML-breakout
  // payloads, so non-XHTML elements are removed entirely.
  const out = htmlOf(sanitizeHtml('<p>a</p><svg><style>&lt;img src=x onerror=alert(1)&gt;</style></svg>'));
  assert.equal(out, '<p>a</p>');
});

test('custom allowed/blocked lists override the defaults', () => {
  const out = htmlOf(sanitizeHtml('<p>keep</p><b>drop-to-text</b>', { allowed: ['P'] }));
  assert.equal(out, '<p>keep</p>drop-to-text');
});

test('a normalizing safeUrl validator can rewrite hrefs', () => {
  const out = htmlOf(sanitizeHtml('<a href="/rel">x</a>', {
    safeUrl: (u) => (u.startsWith('/') ? `https://example.com${u}` : false),
  }));
  assert.match(out, /href="https:\/\/example\.com\/rel"/);
});

test('deeply nested hostile input does not overflow the stack', () => {
  const depth = 5000;
  const html = '<div>'.repeat(depth) + 'x' + '</div>'.repeat(depth);
  // Must not throw; content beyond the recursion bound is dropped, not crashed on.
  assert.doesNotThrow(() => sanitizeHtml(html));
});
