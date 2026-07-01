import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml, safeUrl, safeUrlAttr } from '../index.js';

test('escHtml escapes the five significant characters', () => {
  assert.equal(escHtml(`<a href="x" id='y'>&`), '&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;');
});

test('escHtml coerces null/undefined to empty string', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(42), '42');
});

test('safeUrl accepts http(s) and returns normalized href', () => {
  assert.equal(safeUrl('https://example.com/a?b=1&c=2'), 'https://example.com/a?b=1&c=2');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
});

test('safeUrl rejects dangerous and relative URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,x'), null);
  assert.equal(safeUrl('/relative/path'), null);
  assert.equal(safeUrl(''), null);
  assert.equal(safeUrl(null), null);
});

test('safeUrlAttr HTML-escapes the validated href and returns "" on reject', () => {
  assert.equal(safeUrlAttr('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&amp;b=2');
  assert.equal(safeUrlAttr('javascript:alert(1)'), '');
});
