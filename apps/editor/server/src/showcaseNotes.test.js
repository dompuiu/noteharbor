import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Ticket 10: the `notes` batch on POST /api/showcases/:id/nodes. The HTTP seam
// covers the contract the picker uses; the database seam covers the batch
// insert's order and position handling without an HTTP round trip.

let serverModule;
let db;
let tempDir;
let server;
let baseUrl;
let collection;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-showcase-notes-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  db = await import('./db.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  collection = db.createCollection('Notes');
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
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

async function createShowcase(name) {
  const { body } = await api('/api/showcases', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  return body.showcase;
}

function createNote(overrides = {}) {
  return db.createNote({
    collection_id: collection.id,
    denomination: '1',
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
    images: [],
    ...overrides
  });
}

async function placeCategory(showcaseId, name) {
  const { body } = await api(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'category', name })
  });
  return body.node;
}

test('POST /api/showcases/:id/nodes adds a notes batch in one call', async () => {
  const showcase = await createShowcase('Batch HTTP');
  const category = await placeCategory(showcase.id, 'Kingdom');
  const first = createNote({ denomination: '1 leu', catalog_number: '22' });
  const second = createNote({ denomination: '2 lei', catalog_number: '220' });
  const third = createNote({ denomination: '100 lei', catalog_number: '500' });

  const { response, body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'notes',
      parent_id: category.id,
      note_ids: [first.id, second.id, third.id]
    })
  });

  assert.equal(response.status, 201);
  assert.equal(body.nodes.length, 3);
  assert.deepEqual(
    body.nodes.map((node) => node.node_type),
    ['note', 'note', 'note']
  );
  assert.deepEqual(
    body.nodes.map((node) => node.note_id),
    [first.id, second.id, third.id]
  );
  // Every node carries the referenced Note for the card.
  assert.equal(body.nodes[0].note.denomination, '1 leu');
  assert.deepEqual(
    body.nodes.map((node) => node.position),
    [1, 2, 3]
  );

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes.length, 1);
  assert.deepEqual(
    tree.nodes[0].children.map((node) => node.note_id),
    [first.id, second.id, third.id]
  );
});

test('a second batch appends after the notes already in the node', async () => {
  const showcase = await createShowcase('Batch appends');
  const category = await placeCategory(showcase.id, 'Append');
  const first = createNote({ denomination: '1' });
  const second = createNote({ denomination: '2' });

  await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: category.id, note_ids: [first.id] })
  });

  const { body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: category.id, note_ids: [second.id] })
  });

  assert.deepEqual(
    body.nodes.map((node) => node.position),
    [2]
  );

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(
    tree.nodes[0].children.map((node) => node.note_id),
    [first.id, second.id]
  );
});

test('the notes batch drops duplicates while preserving the given order', async () => {
  const showcase = await createShowcase('Batch dedupe');
  const category = await placeCategory(showcase.id, 'Dedupe');
  const first = createNote({ denomination: '1' });
  const second = createNote({ denomination: '2' });

  const { body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'notes',
      parent_id: category.id,
      note_ids: [first.id, second.id, first.id]
    })
  });

  assert.deepEqual(
    body.nodes.map((node) => node.note_id),
    [first.id, second.id]
  );
});

test('the notes batch validates the parent and the note ids', async () => {
  const showcase = await createShowcase('Batch guards');
  const other = await createShowcase('Batch guards other');
  const category = await placeCategory(showcase.id, 'Guarded');
  const otherCategory = await placeCategory(other.id, 'Elsewhere');
  const note = createNote({ denomination: '1' });

  const noParent = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', note_ids: [note.id] })
  });
  assert.equal(noParent.response.status, 400);

  const foreignParent = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'notes',
      parent_id: otherCategory.id,
      note_ids: [note.id]
    })
  });
  assert.equal(foreignParent.response.status, 400);
  assert.match(foreignParent.body.error, /parent/i);

  const empty = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: category.id, note_ids: [] })
  });
  assert.equal(empty.response.status, 400);

  const unknownNote = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: category.id, note_ids: [999999] })
  });
  assert.equal(unknownNote.response.status, 400);
  assert.match(unknownNote.body.error, /not found/i);

  // Nothing from the failed batches landed.
  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(tree.nodes[0].children, []);
});

test('a note node cannot be a parent for a notes batch', async () => {
  const showcase = await createShowcase('Note parent');
  const category = await placeCategory(showcase.id, 'Note parent category');
  const note = createNote({ denomination: '1' });

  const { body: placed } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: category.id, note_ids: [note.id] })
  });

  const { response, body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'notes',
      parent_id: placed.nodes[0].id,
      note_ids: [createNote({ denomination: '2' }).id]
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /cannot hold notes/i);
});

// Database seam --------------------------------------------------------------

test('addNotesToNode inserts the batch in order at the database seam', () => {
  const showcase = db.createShowcase('Batch seam');
  const category = db.addShowcaseNode(showcase.id, {
    type: 'category',
    name: 'Seam category'
  });
  const first = createNote({ denomination: '1' });
  const second = createNote({ denomination: '2' });
  const third = createNote({ denomination: '3' });

  const nodes = db.addShowcaseNode(showcase.id, {
    type: 'notes',
    parent_id: category.id,
    note_ids: [third.id, first.id, second.id]
  });

  assert.deepEqual(
    nodes.map((node) => node.note_id),
    [third.id, first.id, second.id]
  );
  assert.deepEqual(
    nodes.map((node) => node.position),
    [1, 2, 3]
  );
  assert.equal(nodes[0].parent_node_id, category.id);
  assert.equal(nodes[0].node_type, 'note');
});
