import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDenomination } from './denomination.js';

test('normalizes denomination with thousands separators', () => {
  assert.equal(normalizeDenomination('1000 Lei'), '1,000 Lei');
  assert.equal(normalizeDenomination('100000 Lei'), '100,000 Lei');
});

test('preserves decimals while formatting the leading amount', () => {
  assert.equal(normalizeDenomination('1000.50 Lei'), '1,000.50 Lei');
});

test('formats only the leading amount and preserves suffix text', () => {
  assert.equal(normalizeDenomination('1000 Lei 1991'), '1,000 Lei 1991');
  assert.equal(normalizeDenomination('1000 lei'), '1,000 lei');
});

test('leaves non-leading numeric denominations unchanged', () => {
  assert.equal(normalizeDenomination('P-82 1000 Lei'), 'P-82 1000 Lei');
});

test('is idempotent for already formatted values', () => {
  assert.equal(normalizeDenomination('1,000 Lei'), '1,000 Lei');
});
