import test from 'node:test';
import assert from 'node:assert/strict';
import { mapRow } from './routes/import.js';

test('csv import normalizes denomination formatting', () => {
  const note = mapRow(['1000 Lei', '', 'P-1']);

  assert.equal(note.denomination, '1,000 Lei');
});
