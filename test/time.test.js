import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relativeTime } from '../index.js';

const NOW = Date.parse('2026-06-29T12:00:00Z');

test('formats sub-minute, minutes and hours', () => {
  assert.equal(relativeTime(NOW - 10_000, NOW), 'just now');
  assert.equal(relativeTime(NOW - 3 * 60_000, NOW), '3m ago');
  assert.equal(relativeTime(NOW - 2 * 3600_000, NOW), '2h ago');
});

test('formats older dates as month + day, adding year when different', () => {
  assert.equal(relativeTime(Date.parse('2026-06-16T12:00:00Z'), NOW), 'Jun 16');
  assert.equal(relativeTime(Date.parse('2025-12-25T12:00:00Z'), NOW), 'Dec 25, 2025');
});

test('accepts ISO strings and Date objects, returns "" for junk', () => {
  assert.equal(relativeTime('2026-06-29T11:59:40Z', NOW), 'just now');
  assert.equal(relativeTime(new Date(NOW - 5 * 60_000), NOW), '5m ago');
  assert.equal(relativeTime('not a date', NOW), '');
  assert.equal(relativeTime(null, NOW), '');
});
