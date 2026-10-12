import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Notes seam: HTTP /api/collections/:id/notes. Verification goes through GET,
// never through the database handle.

let serverModule;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-notes-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function createCollection(name) {
  const { body } = await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  return body.collection;
}

async function createNote(collectionId, overrides = {}) {
  const { body } = await api(`/api/collections/${collectionId}/notes`, {
    method: 'POST',
    body: JSON.stringify({
      denomination: '5 Lei',
      issue_date: '1920',
      catalog_number: '',
      grading_company: '',
      grade: '',
      watermark: '',
      serial: '',
      url: '',
      notes: '',
      tags: [],
      scraped_data: null,
      ...overrides
    })
  });
  return body;
}

test('a created note is retrievable with its tags', async () => {
  const collection = await createCollection('Notes Retrieve');
  const created = await createNote(collection.id, { denomination: '5 Lei', tags: ['paper', 'old'] });
  assert.equal(created.note.denomination, '5 Lei');

  const { response, body } = await api(`/api/collections/${collection.id}/notes/${created.note.id}`);
  assert.equal(response.status, 200);
  assert.equal(body.note.denomination, '5 Lei');
  assert.deepEqual(body.note.tags.map((tag) => tag.name).sort(), ['old', 'paper']);
});

test('creating a note without a denomination is rejected', async () => {
  const collection = await createCollection('Notes Required');
  const { response, body } = await api(`/api/collections/${collection.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '   ' })
  });
  assert.equal(response.status, 400);
  assert.match(body.error, /Denomination is required/);
});

test('creating a note with an unparsable scraped_data payload is rejected', async () => {
  const collection = await createCollection('Notes Scraped');
  const { response, body } = await api(`/api/collections/${collection.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '5 Lei', scraped_data: '{oops' })
  });
  assert.equal(response.status, 400);
  assert.match(body.error, /Invalid scraped_data payload/);
});

test('reading an unknown note answers 404', async () => {
  const collection = await createCollection('Notes Missing');
  const { response } = await api(`/api/collections/${collection.id}/notes/999999`);
  assert.equal(response.status, 404);
});

test('an invalid collection id answers 400 and an unknown one 404', async () => {
  const bad = await api('/api/collections/nope/notes');
  assert.equal(bad.response.status, 400);

  const missing = await api('/api/collections/999999/notes');
  assert.equal(missing.response.status, 404);
});

test('updating a note persists through a re-read', async () => {
  const collection = await createCollection('Notes Update');
  const created = await createNote(collection.id, { denomination: '1 Leu', notes: 'before' });

  const { response, body } = await api(`/api/collections/${collection.id}/notes/${created.note.id}`, {
    method: 'PUT',
    body: JSON.stringify({ denomination: '10 Lei', notes: 'after', tags: [] })
  });
  assert.equal(response.status, 200);
  assert.equal(body.note.denomination, '10 Lei');

  const reread = await api(`/api/collections/${collection.id}/notes/${created.note.id}`);
  assert.equal(reread.body.note.notes, 'after');
});

test('updating an unknown note answers 404', async () => {
  const collection = await createCollection('Notes Update Missing');
  const { response } = await api(`/api/collections/${collection.id}/notes/999999`, {
    method: 'PUT',
    body: JSON.stringify({ denomination: '10 Lei' })
  });
  assert.equal(response.status, 404);
});

test('a deleted note stays deleted', async () => {
  const collection = await createCollection('Notes Delete');
  const created = await createNote(collection.id);

  const { response } = await api(`/api/collections/${collection.id}/notes/${created.note.id}`, {
    method: 'DELETE'
  });
  assert.equal(response.status, 200);

  const reread = await api(`/api/collections/${collection.id}/notes/${created.note.id}`);
  assert.equal(reread.response.status, 404);
});

test('reorder persists the new order and rejects a partial list', async () => {
  const collection = await createCollection('Notes Reorder');
  const first = await createNote(collection.id, { denomination: '1 Leu' });
  const second = await createNote(collection.id, { denomination: '2 Lei' });

  const { response, body } = await api(`/api/collections/${collection.id}/notes/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids: [second.note.id, first.note.id] })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(body.notes.map((note) => note.id), [second.note.id, first.note.id]);

  const partial = await api(`/api/collections/${collection.id}/notes/reorder`, {
    method: 'POST',
    body: JSON.stringify({ ids: [first.note.id] })
  });
  assert.equal(partial.response.status, 400);
});

test('move validates the target and the position before touching anything', async () => {
  const collection = await createCollection('Notes Move From');
  const created = await createNote(collection.id);

  const same = await api(`/api/collections/${collection.id}/notes/${created.note.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ target_collection_id: collection.id, position_mode: 'end' })
  });
  assert.equal(same.response.status, 400);
  assert.match(same.body.error, /already in this collection/);

  const badMode = await api(`/api/collections/${collection.id}/notes/${created.note.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ target_collection_id: collection.id + 1000, position_mode: 'middle' })
  });
  assert.equal(badMode.response.status, 404);

  const other = await createCollection('Notes Move To');
  const missingRef = await api(`/api/collections/${collection.id}/notes/${created.note.id}/move`, {
    method: 'POST',
    body: JSON.stringify({ target_collection_id: other.id, position_mode: 'before' })
  });
  assert.equal(missingRef.response.status, 400);
  assert.match(missingRef.body.error, /reference note/);
});
