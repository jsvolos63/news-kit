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

// NUL and lone surrogates are not characters a caller can carry safely: NUL is
// the control byte a browser drops from a URL before resolving its scheme (the
// smuggling URL_CONTROL_CHARS exists to stop, arriving one layer earlier), and
// an unpaired surrogate breaks JSON round-trips, TextEncoder and
// structuredClone. String.fromCodePoint accepts both; safeFromCodePoint must
// not. A well-formed document contains neither reference.
test('drops &#0; rather than emitting a literal NUL', () => {
  assert.equal(decodeEntities('a&#0;b'), 'ab');
  assert.equal(decodeEntities('a&#x0;b'), 'ab');
  assert.equal(decodeEntities('a&#00;b'), 'ab');
  assert.ok(!decodeEntities('&#0;javascript:x').includes(String.fromCharCode(0)));
});

test('drops surrogate-range refs rather than emitting a lone surrogate', () => {
  for (const ref of ['&#xD800;', '&#xDC00;', '&#xDFFF;', '&#55296;', '&#57343;']) {
    const out = decodeEntities(`a${ref}b`);
    assert.equal(out, 'ab', ref);
    // A lone surrogate would not survive this round trip.
    assert.equal(JSON.parse(JSON.stringify(out)), 'ab', ref);
  }
});

test('code points either side of the dropped ranges still decode', () => {
  assert.equal(decodeEntities('&#1;'), '\u0001');         // cp 1, just past NUL
  assert.equal(decodeEntities('&#xD7FF;'), '\uD7FF');     // just below the surrogates
  assert.equal(decodeEntities('&#xE000;'), '\uE000');     // just above them
  assert.equal(decodeEntities('&#x1F600;'), '\u{1F600}'); // astral, from a real pair
});
