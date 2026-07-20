import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities } from '../index.js';

test('decodes named entities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(decodeEntities('a &lt; b &gt; c'), 'a < b > c');
  assert.equal(decodeEntities('&quot;quoted&quot;'), '"quoted"');
});

test('decodes numeric decimal and hex', () => {
  assert.equal(decodeEntities('it&#39;s'), "it's");
  assert.equal(decodeEntities('it&#x27;s'), "it's");
});

test('ampersand is decoded last (no double-decode)', () => {
  // &amp;lt; must become the literal "&lt;", NOT "<".
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeEntities('A&amp;amp;B'), 'A&amp;B');
});

test('numeric ampersand refs do not double-decode either', () => {
  // &#38; / &#x26; are deferred to the same final pass as &amp;, so a numeric
  // ampersand ref can never trigger a second round of entity interpretation.
  assert.equal(decodeEntities('&#38;lt;'), '&lt;'); // decimal 38 = '&'
  assert.equal(decodeEntities('&#x26;lt;'), '&lt;'); // hex 26 = '&'
  assert.equal(decodeEntities('&#x26;gt;'), '&gt;');
  // A lone numeric ampersand ref still decodes to a single literal '&'.
  assert.equal(decodeEntities('a &#38; b'), 'a & b');
  assert.equal(decodeEntities('a &#x26; b'), 'a & b');
  // Non-ampersand numeric refs are unaffected.
  assert.equal(decodeEntities('it&#39;s'), "it's");
});

test('leaves unknown entities untouched and handles null', () => {
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(decodeEntities(null), '');
});
