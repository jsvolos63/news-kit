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

test('leaves unknown entities untouched and handles null', () => {
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
  assert.equal(decodeEntities(null), '');
});
