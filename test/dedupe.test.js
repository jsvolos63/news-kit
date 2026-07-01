import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle, stripPublisher, titleSignature, nearDuplicate,
  earliestDate, dedupeItems, mergeItems,
} from '../index.js';

test('normalizeTitle strips ticker, punctuation, case', () => {
  assert.equal(normalizeTitle('[ACME] Big, Bold: News!'), 'big bold news');
});

test('stripPublisher removes the trailing " - Publisher"', () => {
  assert.equal(stripPublisher('Acme raises Series B - TechCrunch'), 'Acme raises Series B');
  assert.equal(stripPublisher('No publisher here'), 'No publisher here');
});

test('titleSignature drops stopwords and company name tokens', () => {
  const sig = titleSignature('Acme to launch new payments product - Reuters', 'Acme');
  assert.ok(sig.includes('launch'));
  assert.ok(sig.includes('payments'));
  assert.ok(sig.includes('product'));
  assert.ok(!sig.includes('acme'));
  assert.ok(!sig.includes('new')); // stopword
  assert.ok(!sig.includes('to')); // stopword + length
});

test('nearDuplicate clusters reworded headlines, separates distinct ones', () => {
  const a = new Set(titleSignature('Acme launches instant payments platform for merchants'));
  const b = titleSignature('Acme unveils instant payments platform aimed at merchants');
  const c = titleSignature('Globex appoints new chief financial officer');
  assert.equal(nearDuplicate(b, a), true);
  assert.equal(nearDuplicate(c, a), false);
});

test('earliestDate keeps the earlier ISO date', () => {
  assert.equal(
    earliestDate('2026-06-17T12:00:00Z', '2026-06-15T00:00:00Z'),
    '2026-06-15T00:00:00Z',
  );
});

test('dedupeItems collapses duplicates, keeps earliest date + best signal', () => {
  const items = [
    { title: 'Acme raises $50M Series B - TechCrunch', url: 'u1', published_at: '2026-06-17T00:00:00Z', signal: 'funding' },
    { title: 'Acme raises $50M Series B round - Bloomberg', url: 'u2', published_at: '2026-06-16T00:00:00Z', signal: 'funding' },
    { title: 'Globex hires new CEO - Reuters', url: 'u3', published_at: '2026-06-15T00:00:00Z', signal: 'leadership' },
  ];
  const out = dedupeItems(items);
  assert.equal(out.length, 2);
  const acme = out.find((x) => /Acme/.test(x.title));
  assert.equal(acme.published_at, '2026-06-16T00:00:00Z'); // pulled earlier
});

test('mergeItems never lets an empty fresh fetch blank previous items', () => {
  const prev = [{ title: 'Old story', url: 'u1', published_at: '2026-06-17T00:00:00Z' }];
  const merged = mergeItems(prev, [], { cap: 10 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, 'u1');
});

test('mergeItems drops items older than the cutoff window', () => {
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const recent = new Date(Date.now() - 1 * 86400000).toISOString();
  const merged = mergeItems(
    [{ title: 'Ancient', url: 'old', published_at: old }],
    [{ title: 'Recent', url: 'new', published_at: recent }],
    { cutoffDays: 60 },
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].url, 'new');
});
