// DOM-dependent tests for the source-menu module (and the river's new
// skeleton/grouping helpers). jsdom is installed on globalThis BEFORE the
// kit is imported, mirroring the other *-dom test files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { JSDOM } = await import('jsdom');
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.document = window.document;

const {
  createSourceMenu,
  countBySource,
  ensureSourceMenuStyles,
  SOURCE_MENU_CSS,
  renderNewsRiverSkeletons,
  renderNewsRiver,
  riverCoarseGroupLabel,
} = await import('../index.js');

const NOW = Date.parse('2026-07-18T15:00:00'); // local-time anchor for day math

function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    dump: () => Object.fromEntries(map),
  };
}

function container() {
  const el = window.document.createElement('div');
  window.document.body.appendChild(el);
  return el;
}

const ITEMS = [
  { title: 'a1', source: 'espn' },
  { title: 'a2', source: 'espn' },
  { title: 'a3', source: 'espn' },
  { title: 'b1', source: 'trib' },
  { title: 'b2', source: 'trib' },
  { title: 'c1', source: 'suntimes' },
  { title: 'x', source: '' },
];

test('countBySource: counts by item.source, prototype-safe, custom accessor', () => {
  const counts = countBySource(ITEMS);
  assert.deepEqual({ ...counts }, { espn: 3, trib: 2, suntimes: 1 });
  // Null-prototype: hostile keys are plain data, and lookups can't walk up.
  const hostile = countBySource([{ source: '__proto__' }, { source: 'constructor' }]);
  assert.equal(hostile.__proto__, 1);
  assert.equal(hostile.constructor, 1);
  assert.equal(Object.getPrototypeOf(hostile), null);
  // Custom accessor.
  const bySrc = countBySource([{ src: 'a' }, { src: 'a' }], (it) => it.src);
  assert.deepEqual({ ...bySrc }, { a: 2 });
});

test('filterItems precedence: drill wins over multi-select; empty selection = all', () => {
  const menu = createSourceMenu({ doc: window.document, storage: fakeStorage() });
  assert.equal(menu.filterItems(ITEMS).length, ITEMS.length);
  menu.toggle('espn');
  menu.toggle('trib');
  assert.deepEqual(menu.filterItems(ITEMS).map((i) => i.title), ['a1', 'a2', 'a3', 'b1', 'b2']);
  menu.drillTo('suntimes');
  assert.deepEqual(menu.filterItems(ITEMS).map((i) => i.title), ['c1']);
  // Re-tapping the pinned source unpins it, restoring the multi-select view.
  menu.drillTo('suntimes');
  assert.deepEqual(menu.filterItems(ITEMS).map((i) => i.title), ['a1', 'a2', 'a3', 'b1', 'b2']);
  menu.clear();
  assert.equal(menu.filterItems(ITEMS).length, ITEMS.length);
  assert.equal(menu.isFiltered(), false);
});

test('multi-select persists; drill-down is deliberately session-only', () => {
  const storage = fakeStorage();
  const menu = createSourceMenu({ doc: window.document, storage, storageKey: 'k' });
  menu.toggle('espn');
  menu.drillTo('trib');
  assert.deepEqual(JSON.parse(storage.dump().k), ['espn']);

  // A fresh controller over the same storage restores the checkboxes only.
  const next = createSourceMenu({ doc: window.document, storage, storageKey: 'k' });
  assert.deepEqual(next.state(), { drill: null, selected: ['espn'] });
});

test('corrupt or throwing storage degrades to "all sources", never throws', () => {
  const corrupt = createSourceMenu({
    doc: window.document,
    storageKey: 'k',
    storage: fakeStorage({ k: '{not json' }),
  });
  assert.deepEqual(corrupt.state().selected, []);

  const thrower = createSourceMenu({
    doc: window.document,
    storageKey: 'k',
    storage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } },
  });
  thrower.toggle('espn'); // setItem throws — swallowed
  assert.deepEqual(thrower.state().selected, ['espn']);
});

test('toggle supersedes a drill-down (the pin drops so checkboxes show)', () => {
  const menu = createSourceMenu({ doc: window.document, storage: fakeStorage() });
  menu.drillTo('espn');
  menu.toggle('trib');
  assert.deepEqual(menu.state(), { drill: null, selected: ['trib'] });
});

test('onChange fires with the reason after every state change', () => {
  const reasons = [];
  const menu = createSourceMenu({
    doc: window.document,
    storage: fakeStorage(),
    onChange: (reason) => reasons.push(reason),
  });
  menu.drillTo('espn');
  menu.toggle('trib');
  menu.clear();
  assert.deepEqual(reasons, ['drill', 'toggle', 'clear']);
});

test('renderMenu: heading, all-row, busiest-first rows, zero-count rows inert, drill+checkbox wiring', () => {
  const el = container();
  const storage = fakeStorage({ k: JSON.stringify(['gone']) }); // persisted source absent from feed
  const reasons = [];
  const menu = createSourceMenu({
    doc: window.document,
    storage,
    storageKey: 'k',
    sourceLabels: { espn: 'ESPN', trib: 'Tribune', suntimes: 'Sun-Times', gone: 'Gone Outlet' },
    onChange: (reason) => reasons.push(reason),
  });
  menu.setCounts(countBySource(ITEMS));
  menu.renderMenu(el);

  assert.ok(el.classList.contains('nk-sources'));
  assert.equal(el.querySelector('.nk-sources-heading').textContent, 'Sources');
  // All-row shows the total and is not active (a selection exists).
  const all = el.querySelector('.nk-source-all');
  assert.equal(all.getAttribute('aria-pressed'), 'false');
  assert.equal(all.querySelector('.nk-source-count').textContent, '6');

  // Busiest first, with the persisted-but-absent source appended at count 0.
  const names = [...el.querySelectorAll('.nk-source-row .nk-source-name')].map((n) => n.textContent);
  assert.deepEqual(names, ['ESPN', 'Tribune', 'Sun-Times', 'Gone Outlet']);
  const rows = [...el.querySelectorAll('.nk-source-row')];
  const goneRow = rows[3];
  assert.equal(goneRow.querySelector('.nk-source-link').disabled, true); // nothing to drill into
  assert.equal(goneRow.querySelector('.nk-source-checkbox').checked, true); // still uncheckable

  // Drilling via the name button re-renders the menu with the active row.
  rows[0].querySelector('.nk-source-link').click();
  assert.deepEqual(menu.state().drill, 'espn');
  assert.ok(el.querySelector('.nk-source-row--active .nk-source-name').textContent === 'ESPN');
  assert.equal(el.querySelector('.nk-source-row--active .nk-source-link').getAttribute('aria-pressed'), 'true');

  // Checking a box clears the drill and persists.
  const tribBox = [...el.querySelectorAll('.nk-source-row')]
    .find((r) => r.querySelector('.nk-source-name').textContent === 'Tribune')
    .querySelector('.nk-source-checkbox');
  tribBox.click();
  assert.equal(menu.state().drill, null);
  assert.deepEqual(new Set(menu.state().selected), new Set(['gone', 'trib']));
  assert.deepEqual(new Set(JSON.parse(storage.dump().k)), new Set(['gone', 'trib']));

  // All-row resets everything.
  el.querySelector('.nk-source-all').click();
  assert.equal(menu.isFiltered(), false);
  assert.equal(el.querySelector('.nk-source-all').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(reasons, ['drill', 'toggle', 'clear']);
});

test('renderButton: label, summed count, caret, is-filtered class', () => {
  const btn = window.document.createElement('button');
  window.document.body.appendChild(btn);
  const menu = createSourceMenu({
    doc: window.document,
    storage: fakeStorage(),
    sourceLabels: (s) => s.toUpperCase(),
  });
  menu.setCounts(countBySource(ITEMS));
  menu.renderButton(btn);
  assert.equal(btn.textContent, 'All sources6▾');
  assert.equal(btn.classList.contains('is-filtered'), false);

  menu.toggle('espn');
  assert.equal(btn.textContent, 'ESPN3▾'); // auto re-render on change
  assert.ok(btn.classList.contains('is-filtered'));

  menu.toggle('trib');
  assert.equal(menu.buttonState().text, '2 sources');
  assert.equal(menu.buttonState().count, 5);

  menu.drillTo('suntimes');
  assert.deepEqual(menu.buttonState(), { text: 'SUNTIMES', count: 1, active: true });
});

test('menu styles install exactly once (style-tag fallback path in jsdom)', () => {
  ensureSourceMenuStyles(window.document);
  ensureSourceMenuStyles(window.document);
  const styles = [...window.document.querySelectorAll('style')]
    .filter((s) => s.textContent === SOURCE_MENU_CSS);
  assert.equal(styles.length, 1);
});

test('skeletons: fixed placeholder cards, aria-hidden, replaced by a real render', () => {
  const el = container();
  renderNewsRiverSkeletons(el, { count: 4 });
  assert.ok(el.classList.contains('nk-river'));
  const cards = el.querySelectorAll('.nk-card.nk-skel');
  assert.equal(cards.length, 4);
  assert.equal(cards[0].getAttribute('aria-hidden'), 'true');
  assert.equal(cards[0].querySelectorAll('.nk-skel-bar').length, 4);

  // The count is clamped to something sane.
  renderNewsRiverSkeletons(el, { count: 500 });
  assert.equal(el.querySelectorAll('.nk-skel').length, 20);
  renderNewsRiverSkeletons(el, { count: -3 });
  assert.equal(el.querySelectorAll('.nk-skel').length, 1);
  renderNewsRiverSkeletons(el);
  assert.equal(el.querySelectorAll('.nk-skel').length, 6);

  // A later real render over the same container clears every skeleton.
  renderNewsRiver(el, [{ title: 'T', ts: NOW }], { now: NOW });
  assert.equal(el.querySelectorAll('.nk-skel').length, 0);
  assert.equal(el.querySelectorAll('.nk-card').length, 1);
});

test('riverCoarseGroupLabel: coarse buckets for long-window feeds', () => {
  const day = 24 * 3600_000;
  assert.equal(riverCoarseGroupLabel(NOW - 3600_000, NOW), 'Today');
  assert.equal(riverCoarseGroupLabel(NOW - day, NOW), 'Yesterday');
  assert.equal(riverCoarseGroupLabel(NOW - 3 * day, NOW), 'Earlier this week');
  assert.equal(riverCoarseGroupLabel(NOW - 10 * day, NOW), 'Earlier this month');
  assert.equal(riverCoarseGroupLabel(NOW - 45 * day, NOW), 'Older');
  assert.equal(riverCoarseGroupLabel('garbage', NOW), null);
  assert.equal(riverCoarseGroupLabel(null, NOW), null);
});

test('renderNewsRiver accepts a custom groupLabel (coarse dividers)', () => {
  const el = container();
  const day = 24 * 3600_000;
  renderNewsRiver(el, [
    { title: 'new', ts: NOW - 1000 },
    { title: 'week', ts: NOW - 4 * day },
    { title: 'old', ts: NOW - 60 * day },
  ], { now: NOW, groupLabel: riverCoarseGroupLabel });
  const days = [...el.querySelectorAll('.nk-day')].map((d) => d.textContent);
  assert.deepEqual(days, ['Today', 'Earlier this week', 'Older']);
});
