import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escHtml, safeContentUrl, safeContentUrlAttr } from '../index.js';

test('escHtml escapes the five significant characters', () => {
  assert.equal(escHtml(`<a href="x" id='y'>&`), '&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;');
});

test('escHtml coerces null/undefined to empty string', () => {
  assert.equal(escHtml(null), '');
  assert.equal(escHtml(undefined), '');
  assert.equal(escHtml(42), '42');
});

test('safeContentUrl accepts http(s) and returns normalized href', () => {
  assert.equal(safeContentUrl('https://example.com/a?b=1&c=2'), 'https://example.com/a?b=1&c=2');
  assert.equal(safeContentUrl('http://example.com'), 'http://example.com/');
});

test('safeContentUrl rejects dangerous and relative URLs', () => {
  assert.equal(safeContentUrl('javascript:alert(1)'), null);
  assert.equal(safeContentUrl('data:text/html,x'), null);
  assert.equal(safeContentUrl('/relative/path'), null);
  assert.equal(safeContentUrl(''), null);
  assert.equal(safeContentUrl(null), null);
});

test('safeContentUrlAttr HTML-escapes the validated href and returns "" on reject', () => {
  assert.equal(safeContentUrlAttr('https://example.com/?a=1&b=2'), 'https://example.com/?a=1&amp;b=2');
  assert.equal(safeContentUrlAttr('javascript:alert(1)'), '');
});
