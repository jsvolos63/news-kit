import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, makeClassifier, signalPriority } from '../index.js';

test('default classifier detects signal buckets, first match wins', () => {
  assert.equal(classify('Acme files for IPO at $12B valuation'), 'ipo');
  assert.equal(classify('Startup raises Series C funding round'), 'funding');
  assert.equal(classify('Company reports Q3 2026 earnings beat'), 'financial');
  assert.equal(classify('Globex appoints new CEO'), 'leadership');
  assert.equal(classify('Firm launches new payments product'), 'product');
  assert.equal(classify('A quiet day with no signal words'), 'general');
});

test('signalPriority orders by importance, unknown sorts last', () => {
  assert.ok(signalPriority('ipo') < signalPriority('funding'));
  assert.ok(signalPriority('product') < signalPriority('general'));
  assert.equal(signalPriority('nonsense'), 99);
  assert.equal(signalPriority(undefined), 99);
});

test('makeClassifier supports custom per-app vocabularies', () => {
  const tag = makeClassifier([
    ['RATES', [/\bfed\b|fomc|rate\b/i]],
    ['INFLATION', [/inflat|cpi|ppi/i]],
  ], 'EQUITIES');
  assert.equal(tag('FOMC holds rates steady'), 'RATES');
  assert.equal(tag('CPI runs hot'), 'INFLATION');
  assert.equal(tag('Apple ships a new phone'), 'EQUITIES');
});
