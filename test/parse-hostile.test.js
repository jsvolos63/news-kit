// The regex path's linearity, held at the full MAX_FEED_BYTES in a child
// process with a hard kill (FAM-9 / NWK-1).
//
// test/parse.test.js times the same shapes in-process, which proves the
// bound only while it holds: parseFeed is synchronous, so a regression to
// a quadratic scan would block the test runner for as long as the scan runs
// (the family audit put a 4 MB body at about an hour) before any assertion
// could fail. Here the parse runs in a child that is killed at a deadline,
// so a regression fails in seconds, by name. BearsMockDraft's news-core suite
// works the same way. Run against v0.13.3, the last release with a quadratic
// scan, the shapes that reach one are killed (the record is in MAINTENANCE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const KIT = new URL('../index.js', import.meta.url).href;
const DEADLINE_MS = 15_000; // each shape parses in well under a second at 4 MB

// Each body but the first two sits inside a CLOSED item (`survivor`), so the
// parse reaches the inner scans where the quadratic bugs lived; an unclosed
// item stops the outer walk before any of them runs.
const SHAPES = {
  'unclosed <item': "fill('<item ')",
  'a thousand-plus well-formed items': "fill('<item><title>a</title><link>https://x.example/</link></item>')",
  'unclosed Atom <link (the link scan)': "survivor(fill('<link '))",
  'unclosed <pubDate (the inner open-tag scan)': "survivor(fill('<pubDate '))",
  'unclosed <![CDATA[ (the CDATA unwrap)': "survivor('<description>' + fill('<![CDATA[') + '</description>')",
  'bare < in a CDATA summary (stripTags)': "survivor('<description><![CDATA[' + fill('<') + ']]></description>')",
  'an &lt; run in a summary (stripTags after decoding)': "survivor('<description>' + fill('&lt;') + '</description>')",
  'nested near-miss open tags': "survivor(fill('<titlex'))",
  'unterminated href quotes': "survivor(fill('<link href=\"'))",
};

for (const [label, expr] of Object.entries(SHAPES)) {
  test(`parseFeed stays linear at 4 MB, under a hard kill: ${label}`, () => {
    const script = `import { parseFeed } from ${JSON.stringify(KIT)};
      const M = 4_000_000 - 200; const fill = (u) => u.repeat(Math.ceil(M / u.length)).slice(0, M);
      const survivor = (inner) => '<rss><channel><item><title>Survivor</title>' + inner + '</item></channel></rss>';
      const xml = ${expr};
      const t = performance.now(); const items = parseFeed(xml, { max: 5000 });
      process.stdout.write(JSON.stringify({ ms: performance.now() - t, n: items.length, first: items[0] && items[0].title }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: DEADLINE_MS, killSignal: 'SIGKILL' });
    assert.notEqual(r.signal, 'SIGKILL', `killed after ${DEADLINE_MS} ms: the scan is no longer linear`);
    assert.equal(r.status, 0, r.stderr);
    const { ms, n, first } = JSON.parse(r.stdout);
    assert.ok(ms < DEADLINE_MS, `${Math.round(ms)} ms`);
    // The survivor item is still read: linear AND correct, not linear by
    // giving up early.
    if (SHAPES[label].startsWith('survivor')) assert.equal(first, 'Survivor', `${n} items`);
  });
}
