// DOMParser-path tests for parseFeed. The pure-Node regex path is covered in
// parse.test.js; installing jsdom's DOMParser here (separate process under
// `node --test`) exercises the branch every browser consumer runs, and pins
// the two paths to the same normalized output.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;

const { parseFeed } = await import('../index.js');

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
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

test('DOM path parses RSS with entities decoded exactly once', () => {
  const items = parseFeed(RSS, { source: 'EX' });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Acme & Co raises Series B');
  assert.equal(items[0].url, 'https://example.com/a');
  assert.equal(items[0].source, 'EX');
  assert.match(items[0].published_at, /^2026-06-17T12:00:00/);
  assert.equal(items[0].summary, 'Funding news');
  assert.match(items[0].content, /Full <b>body<\/b>/);
  assert.ok(!items[0].content.includes('CDATA'), 'content has CDATA wrapper stripped');
  assert.equal(items[1].title, 'Second story');
  assert.equal(items[1].ts, null);
});

test('DOM path parses Atom <link href> and <published>', () => {
  const items = parseFeed(ATOM);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom headline');
  assert.equal(items[0].url, 'https://example.com/atom');
  assert.equal(items[0].summary, 'Summary text');
});

test('a literal &amp;amp; in the source stays &amp; (no double decode)', () => {
  const feed = `<rss><channel><item><title>A &amp;amp; B</title><link>https://e.com/x</link></item></channel></rss>`;
  const items = parseFeed(feed);
  assert.equal(items[0].title, 'A &amp; B');
});

test('malformed XML falls back to the tolerant regex parser', () => {
  const broken = `<rss><channel><item><title>Still parsed</title><link>https://e.com/b</link></item>`;
  const items = parseFeed(broken);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Still parsed');
});
