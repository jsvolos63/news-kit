import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, looksLikeFeed } from '../index.js';

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

test('looksLikeFeed', () => {
  assert.equal(looksLikeFeed(RSS), true);
  assert.equal(looksLikeFeed(ATOM), true);
  assert.equal(looksLikeFeed('<html></html>'), false);
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

test('caps never split a surrogate pair (emoji at the title boundary)', () => {
  // 299 ASCII chars + an astral emoji: the 300-unit title cap would land
  // between the emoji's high and low surrogates, leaving a lone surrogate.
  const title = 'a'.repeat(299) + '\u{1F4A5}';
  const xml = `<rss><channel><item><title>${title}</title>` +
    '<link>https://example.com/s</link></item></channel></rss>';
  const [item] = parseFeed(xml);
  assert.equal(item.title.length, 299); // backed off, not cut mid-pair
  assert.ok(!/[\uD800-\uDBFF]$/.test(item.title), 'no trailing lone surrogate');
  // A title that fits is untouched, emoji intact.
  const ok = parseFeed('<rss><channel><item><title>Boom \u{1F4A5}</title>' +
    '<link>https://example.com/t</link></item></channel></rss>');
  assert.equal(ok[0].title, 'Boom \u{1F4A5}');
});

test('the regex path stays linear on a feed full of unclosed tags', () => {
  // rawTag's lazy `[\\s\\S]*?</tag>` restarted a scan-to-end at every
  // unmatched open, nine times per item: 840 KB took 21 s and 3.9 MB never
  // finished. The outer <item> scan was already an indexOf walk; the inner
  // extractors are now the same shape.
  const hostile = '<rss><channel><item>' + '<title>'.repeat(60_000) + '<link>'.repeat(20_000) + '</item></channel></rss>';
  const started = Date.now();
  const items = parseFeed(hostile, { max: 10 });
  assert.ok(Array.isArray(items));
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started}ms`);
});

test('a well-formed feed reads the same through the indexOf extractors', () => {
  const xml = '<rss><channel><item><title>Hello <![CDATA[<b>W</b>]]></title><link>https://x.example/a</link>' +
    '<pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate><description>desc &amp; more</description></item></channel></rss>';
  const [item] = parseFeed(xml);
  assert.equal(item.url, 'https://x.example/a');
  assert.ok(/Hello/.test(item.title));
  assert.equal(item.summary, 'desc & more');
});

// NWK-1 (the family audit's FAM-9). The open-tag scans (`<(item|entry)\b[^>]*>`,
// `<tag\b[^>]*>`, `<link\b([^>]*?)\/?>`), the lazy CDATA unwrap and
// stripTags' /<[^>]*>/g each retried to the end of the input from every
// candidate with no terminator after it. Each shape below is one of those,
// at 200–600 KB, well inside MAX_FEED_BYTES. Measured on v0.13.3 (Node 22):
// 14.1 s, 8.6 s, 5.8 s, 7.3 s, 13.3 s and 7.5 s; under 80 ms each since the
// indexOf walks, and under half a second at the full 4 MB. The bound is wide
// so a loaded runner cannot flake it, and it still sits far below the old
// times.
const survivor = (inner) => `<rss><channel><item><title>Survivor</title>${inner}</item></channel></rss>`;
const HOSTILE = [
  ['unclosed <link  (the Atom link scan)', () => survivor('<link '.repeat(66_000)), 1],
  ['unclosed <item  (the item open scan)', () => '<rss><channel>' + '<item '.repeat(66_000), 0],
  ['unclosed <pubDate  (the inner open-tag scan)', () => survivor('<pubDate '.repeat(44_000)), 1],
  ['unclosed <![CDATA[ (the CDATA unwrap)', () => survivor(`<description>${'<![CDATA['.repeat(44_000)}</description>`), 1],
  ['bare `<` in a CDATA summary (stripTags)', () => survivor(`<description><![CDATA[${'<'.repeat(200_000)}]]></description>`), 1],
  ['an &lt; run in a summary (stripTags, after decoding)', () => survivor(`<description>${'&lt;'.repeat(150_000)}</description>`), 1],
];
for (const [label, make, expected] of HOSTILE) {
  test(`the regex path stays linear: ${label}`, () => {
    const xml = make();
    const started = performance.now();
    const items = parseFeed(xml);
    const took = performance.now() - started;
    assert.equal(items.length, expected);
    if (expected) assert.equal(items[0].title, 'Survivor');
    assert.ok(took < 1500, `${xml.length} bytes took ${Math.round(took)}ms`);
  });
}

test('the indexOf walks keep what the regexes matched (NWK-1)', () => {
  const one = (inner) => parseFeed(`<rss><channel><item><title>t</title>${inner}</item></channel></rss>`)[0];
  // stripTags: a `<…>` span becomes one space; a `<` with no `>` after it is
  // text, as before.
  assert.equal(one('<description>&lt;p&gt;Hi&lt;/p&gt; and 1 &lt; 2</description>').summary, 'Hi and 1 < 2');
  // decodeCdata: complete sections unwrap; an unclosed one and everything
  // after it stay verbatim.
  assert.equal(one('<description><![CDATA[<b>A</b>]]> and <![CDATA[more]]></description>').summary, 'A and more');
  const [cd] = parseFeed('<rss><item><title><![CDATA[A]]> + <![CDATA[B</title></item></rss>');
  assert.equal(cd.title, 'A + <![CDATA[B');
  // Atom links: case-insensitive name, self-closing slash dropped, rel
  // preference kept, `<links>` is not `<link>`.
  assert.equal(one('<links href="https://no.example/"/><LINK rel="self" href="https://self.example/"/>' +
    '<Link href="https://alt.example/" rel="alternate"/>').url, 'https://alt.example/');
  assert.equal(one('<link rel="self" href="https://self.example/"/>').url, 'https://self.example/');
  // An open tag's `>` is the first one after its name, attributes and all.
  assert.equal(one('<pubDate class="x">Mon, 01 Jan 2026 00:00:00 GMT</pubDate>').published_at, '2026-01-01T00:00:00.000Z');
  // An <item> whose open tag never closes ends the scan.
  assert.deepEqual(parseFeed('<rss><item><title>a</title></item><item <title>b</title>'), [parseFeed('<rss><item><title>a</title></item>')[0]]);
});

test('a Turkish capital İ no longer shifts every field after it (v0.13.4)', () => {
  // The inner scans searched block.toLowerCase(), which turns U+0130 into two
  // code units, and sliced `block` with those indices. Each İ moved every
  // later field one character late: "İstanbul<", a link ending in "<".
  const [item] = parseFeed('<rss><channel><item><title>İstanbul borsası</title>' +
    '<link>https://x.example/a</link><description>İİİ news</description></item></channel></rss>');
  assert.equal(item.title, 'İstanbul borsası');
  assert.equal(item.url, 'https://x.example/a');
  assert.equal(item.summary, 'İİİ news');
  // U+212A KELVIN SIGN lowercases to an ASCII `k`, so the old close-tag search
  // took `</lin` + U+212A for `</link`, though the old open-tag regex never
  // matched it. It is not the tag.
  assert.equal(parseFeed('<rss><item><title>t</title><link>https://x.example/k</lin\u212A></item></rss>')[0].url, '');
});

test("foldCase's premise holds on this engine: only U+0130 and U+212A lowercase unsafely", () => {
  // The regex path searches a lowercased copy of each block and slices the
  // original with its indices, so lowercasing must keep every code point's
  // length and must not produce ASCII from a non-ASCII character (which could
  // complete a tag name). foldCase neutralizes exactly these two first. A new
  // Unicode case mapping in a future engine fails this test rather than
  // quietly misaligning feeds.
  const unsafe = [];
  for (let cp = 0x80; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    const lower = ch.toLowerCase();
    if (lower === ch) continue;
    if (lower.length !== ch.length || /[\0-\x7f]/.test(lower)) unsafe.push(cp.toString(16));
  }
  assert.deepEqual(unsafe, ['130', '212a']);
});
