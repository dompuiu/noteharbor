import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRow } from './routes/import.js';

test('csv import normalizes denomination formatting', () => {
  const note = mapRow(['1000 Lei', '', 'P-1']);

  assert.equal(note.denomination, '1,000 Lei');
});

test('csv import normalizes issue date formatting', () => {
  const note = mapRow(['1000 Lei', '1/1/1991', 'P-1']);

  assert.equal(note.issue_date, '01/01/1991');
});
