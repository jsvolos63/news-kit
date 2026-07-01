import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, looksLikeFeed, countItems } from '../index.js';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Acme &amp; Co raises Series B</title>
    <link>https://example.com/a</link>
    <pubDate>Wed, 17 Jun 2026 12:00:00 GMT</pubDate>
    <description>&lt;p&gt;Funding news&lt;/p&gt;</description>
    <content:encoded><![CDATA[<p>Full <b>body</b> here</p>]]></content:encoded>
  </item>
  <item>
    <title><![CDATA[Second story]]></title>
    <link>https://example.com/b</link>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom headline</title>
    <link rel="alternate" href="https://example.com/atom"/>
    <published>2026-06-17T12:00:00Z</published>
    <summary>Summary text</summary>
  </entry>
</feed>`;

test('looksLikeFeed / countItems', () => {
  assert.equal(looksLikeFeed(RSS), true);
  assert.equal(looksLikeFeed('<html></html>'), false);
  assert.equal(countItems(RSS), 2);
  assert.equal(countItems(ATOM), 1);
});

test('parses RSS items (regex path in Node) with entities + CDATA', () => {
  const items = parseFeed(RSS, { source: 'EX' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Acme & Co raises Series B');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].source, 'EX');
  assert.match(items[0].published_at, /^2026-06-17T12:00:00/);
  assert.equal(typeof items[0].ts, 'number');
  assert.equal(items[0].summary, 'Funding news');
  assert.match(items[0].content, /Full <b>body<\/b>/);
  assert.ok(!items[0].content.includes('CDATA'), 'content has CDATA wrapper stripped');
  assert.equal(items[1].title, 'Second story');
  assert.equal(items[1].published_at, ''); // no date
  assert.equal(items[1].ts, null);
});

test('parses Atom <link href> and <published>', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom headline');
  assert.equal(items[0].url, 'https://example.com/atom');
  assert.equal(items[0].summary, 'Summary text');
});

test('applies an injected classifier', () => {
  const items = parseFeed(RSS, { classify: (t) => (/series\s+b/i.test(t) ? 'funding' : 'general') });
  assert.equal(items[0].signal, 'funding');
  assert.equal(items[1].signal, 'general');
});

test('respects max and handles junk input', () => {
  assert.deepEqual(parseFeed('', {}), []);
  assert.deepEqual(parseFeed(null), []);
  assert.equal(parseFeed(RSS, { max: 1 }).length, 1);
});
