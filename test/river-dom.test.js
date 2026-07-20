// DOM-dependent render-river tests. jsdom (devDependency only — index.js
// imports nothing) is installed on globalThis BEFORE the kit is imported so
// the renderer resolves document at call time, mirroring a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = window.document;

const {
  renderNewsRiver,
  newsRiverCard,
  riverDayLabel,
  ensureNewsRiverStyles,
  NEWS_RIVER_CSS,
} = await import('../index.js');

const NOW = Date.parse('2026-07-18T15:00:00'); // local-time anchor for day math

function container() {
  const el = window.document.createElement('main');
  window.document.body.appendChild(el);
  return el;
}

test('riverDayLabel: today / yesterday / weekday, null on garbage', () => {
  assert.equal(riverDayLabel(NOW - 3600_000, NOW), 'Today');
  assert.equal(riverDayLabel(NOW - 24 * 3600_000, NOW), 'Yesterday');
  const older = riverDayLabel(Date.parse('2026-07-02T12:00:00'), NOW);
  assert.match(older, /July 2/);
  assert.equal(riverDayLabel('not a date', NOW), null);
  assert.equal(riverDayLabel(null, NOW), null);
});

test('renders newest-first with day dividers where the local day changes', () => {
  const el = container();
  renderNewsRiver(el, [
    { title: 'Older', publishedAt: new Date(NOW - 26 * 3600_000).toISOString() },
    { title: 'Newest', publishedAt: new Date(NOW - 60_000).toISOString() },
    { title: 'Recent', publishedAt: new Date(NOW - 3600_000).toISOString() },
  ], { now: NOW });

  const kinds = [...el.children].map((c) => c.className.includes('nk-day') ? 'day' : 'card');
  assert.deepEqual(kinds, ['day', 'card', 'card', 'day', 'card']);
  assert.equal(el.querySelectorAll('.nk-day')[0].textContent, 'Today');
  assert.equal(el.querySelectorAll('.nk-day')[1].textContent, 'Yesterday');
  const titles = [...el.querySelectorAll('.nk-headline')].map((h) => h.textContent);
  assert.deepEqual(titles, ['Newest', 'Recent', 'Older']);
  assert.ok(el.classList.contains('nk-river'));
});

test('groupByDay:false renders no dividers; undated items sort last in input order', () => {
  const el = container();
  renderNewsRiver(el, [
    { title: 'undated-a' },
    { title: 'dated', ts: NOW - 1000 },
    { title: 'undated-b' },
  ], { now: NOW, groupByDay: false });
  assert.equal(el.querySelectorAll('.nk-day').length, 0);
  const titles = [...el.querySelectorAll('.nk-headline')].map((h) => h.textContent);
  assert.deepEqual(titles, ['dated', 'undated-a', 'undated-b']);
});

test('feed text is never parsed as HTML', () => {
  const el = container();
  renderNewsRiver(el, [{
    title: '<img src=x onerror=alert(1)> & <b>bold</b>',
    summary: '<script>alert(2)</script>',
    ts: NOW,
  }], { now: NOW });
  assert.equal(el.querySelectorAll('img, script, b').length, 0);
  assert.ok(el.querySelector('.nk-headline').textContent.includes('<b>bold</b>'));
});

test('card meta: source label, relative time, chip and badge kinds', () => {
  const card = newsRiverCard({
    title: 'T',
    source: 'guardian',
    ts: NOW - 13 * 60_000,
    tag: 'rates',
    badge: { text: 'Full Text', kind: 'full' },
  }, { doc: window.document, now: NOW, sourceLabels: { guardian: 'The Guardian' } });

  assert.equal(card.getAttribute('data-source'), 'guardian');
  assert.equal(card.querySelector('.nk-src').textContent, 'The Guardian');
  assert.equal(card.querySelector('.nk-time').textContent, '13m ago');
  assert.equal(card.querySelector('.nk-chip').textContent, 'rates');
  const badge = card.querySelector('.nk-badge');
  assert.equal(badge.textContent, 'Full Text');
  assert.ok(badge.classList.contains('nk-badge-full'));
});

test('badge kind is dropped from the class when not a plain token', () => {
  const card = newsRiverCard(
    { title: 'T', badge: { text: 'X', kind: 'evil kind"' } },
    { doc: window.document, now: NOW },
  );
  assert.equal(card.querySelector('.nk-badge').className, 'nk-badge');
});

test('headline with a safe url is a decorated anchor; unsafe url renders no link', () => {
  const safe = newsRiverCard({ title: 'T', url: 'https://example.com/a' }, { doc: window.document, now: NOW });
  const a = safe.querySelector('.nk-headline a');
  assert.equal(a.getAttribute('href'), 'https://example.com/a');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');

  const unsafe = newsRiverCard({ title: 'T', url: 'javascript:alert(1)' }, { doc: window.document, now: NOW });
  assert.equal(unsafe.querySelector('.nk-headline a'), null);
  assert.equal(unsafe.querySelector('.nk-headline span').textContent, 'T');
});

test('onOpen intercepts plain clicks, honors `false` (deep link), ignores modified clicks', () => {
  const calls = [];
  let allow = false;
  const card = newsRiverCard({ title: 'T', url: 'https://example.com/a' }, {
    doc: window.document,
    now: NOW,
    onOpen: (item, e) => { calls.push(item.title); return allow ? false : undefined; },
  });
  window.document.body.appendChild(card);
  const a = card.querySelector('.nk-headline a');

  const click = (init) => {
    const e = new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    a.dispatchEvent(e);
    return e;
  };

  // Plain click → intercepted (reader path): onOpen called, default prevented.
  assert.equal(click({}).defaultPrevented, true);
  assert.equal(calls.length, 1);

  // onOpen returns false → deep link: anchor keeps its default navigation.
  allow = true;
  assert.equal(click({}).defaultPrevented, false);
  assert.equal(calls.length, 2);

  // Modified click → untouched, onOpen never called.
  assert.equal(click({ ctrlKey: true }).defaultPrevented, false);
  assert.equal(click({ button: 1 }).defaultPrevented, false);
  assert.equal(calls.length, 2);
});

test('onOpen with no url renders a button headline', () => {
  const calls = [];
  const card = newsRiverCard({ title: 'T' }, {
    doc: window.document, now: NOW, onOpen: () => { calls.push(1); },
  });
  const btn = card.querySelector('.nk-headline button');
  assert.equal(btn.getAttribute('type'), 'button');
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, 1);
});

test('byline: authors join and "Read at" appears for link-badged cards by default', () => {
  const card = newsRiverCard({
    title: 'T',
    url: 'https://example.com/a',
    source: 'nyt',
    authors: ['A. Writer', 'B. Reporter'],
    badge: { text: 'Deep Link', kind: 'link' },
  }, { doc: window.document, now: NOW, sourceLabels: { nyt: 'The New York Times' } });
  const by = card.querySelector('.nk-byline');
  assert.match(by.textContent, /A\. Writer, B\. Reporter · Read at The New York Times →/);

  const noRead = newsRiverCard({
    title: 'T', url: 'https://example.com/a', source: 'nyt', badge: { text: 'Full Text', kind: 'full' },
  }, { doc: window.document, now: NOW, readAt: 'never' });
  assert.equal(noRead.querySelector('.nk-byline'), null);
});

test('thumbnail and favicon render only for safe URLs', () => {
  const card = newsRiverCard({
    title: 'T',
    image: 'https://example.com/pic.jpg',
    icon: 'https://example.com/fav.png',
  }, { doc: window.document, now: NOW });
  assert.equal(card.querySelector('.nk-thumb').getAttribute('src'), 'https://example.com/pic.jpg');
  assert.equal(card.querySelector('.nk-thumb').getAttribute('loading'), 'lazy');
  assert.equal(card.querySelector('.nk-favicon').getAttribute('src'), 'https://example.com/fav.png');

  const bad = newsRiverCard({
    title: 'T', image: 'javascript:alert(1)', icon: 'data:text/html,x',
  }, { doc: window.document, now: NOW });
  assert.equal(bad.querySelector('.nk-thumb'), null);
  assert.equal(bad.querySelector('.nk-favicon'), null);
  assert.equal(bad.querySelector('.nk-row'), null); // no empty thumbnail row
});

test('accents set the --nk-accent custom property via CSSOM', () => {
  const card = newsRiverCard({ title: 'T', source: 'guardian' }, {
    doc: window.document, now: NOW, accents: { guardian: '#0084c6' },
  });
  assert.equal(card.style.getPropertyValue('--nk-accent'), '#0084c6');
});

test('kicker renders above the headline', () => {
  const card = newsRiverCard({ title: 'T', kicker: 'Stadium' }, { doc: window.document, now: NOW });
  const main = card.querySelector('.nk-main');
  const classes = [...main.children].map((c) => c.className);
  assert.ok(classes.indexOf('nk-kicker') < classes.indexOf('nk-headline'));
  assert.equal(card.querySelector('.nk-kicker').textContent, 'Stadium');
});

test('empty state and style installation are idempotent', () => {
  const el = container();
  renderNewsRiver(el, [], { now: NOW, emptyMessage: 'Nothing yet.' });
  renderNewsRiver(el, [], { now: NOW });
  assert.equal(el.querySelector('.nk-empty').textContent, 'No stories yet.');
  // jsdom lacks constructable stylesheets, so the <style> fallback path runs —
  // exactly once for the document, however many rivers render.
  const styles = [...window.document.querySelectorAll('style')]
    .filter((s) => s.textContent === NEWS_RIVER_CSS);
  assert.equal(styles.length, 1);
  ensureNewsRiverStyles(window.document);
  assert.equal(
    [...window.document.querySelectorAll('style')].filter((s) => s.textContent === NEWS_RIVER_CSS).length,
    1,
  );
});

test('styles:false skips installation into a fresh document', async () => {
  const fresh = new JSDOM('<!doctype html><html><body><main id="m"></main></body></html>');
  const el = fresh.window.document.getElementById('m');
  renderNewsRiver(el, [{ title: 'T', ts: NOW }], { now: NOW, styles: false, doc: fresh.window.document });
  assert.equal(fresh.window.document.querySelectorAll('style').length, 0);
  assert.equal(el.querySelectorAll('.nk-card').length, 1);
});
