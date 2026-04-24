import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIssueDate } from './dateNormalization.js';

test('keeps year-only dates unchanged', () => {
  assert.equal(normalizeIssueDate('1991'), '1991');
});

test('pads month and day for full slash dates', () => {
  assert.equal(normalizeIssueDate('1/1/1991'), '01/01/1991');
  assert.equal(normalizeIssueDate('06/18/1948'), '06/18/1948');
});

test('pads partial slash dates when possible', () => {
  assert.equal(normalizeIssueDate('1/1991'), '01/1991');
  assert.equal(normalizeIssueDate('1/1'), '01/01');
  assert.equal(normalizeIssueDate('1/1/91'), '01/01/91');
});

test('trims whitespace before normalizing', () => {
  assert.equal(normalizeIssueDate(' 1/1/1991 '), '01/01/1991');
});

test('leaves non-slash non-year values unchanged', () => {
  assert.equal(normalizeIssueDate('circa 1991'), 'circa 1991');
  assert.equal(normalizeIssueDate(''), '');
});
