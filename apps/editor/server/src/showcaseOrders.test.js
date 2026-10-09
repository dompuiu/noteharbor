import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let serverModule;
let db;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-showcase-orders-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  db = await import('./db.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
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

async function placeCategory(showcaseId, name) {
  const { body } = await api(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'category', name })
  });
  return body.node;
}

async function addGrouping(showcaseId, parentId, name) {
  const { body } = await api(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'grouping', parent_id: parentId, name })
  });
  return body.node;
}

async function addNotes(showcaseId, parentId, noteIds) {
  const { body } = await api(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'notes', parent_id: parentId, note_ids: noteIds })
  });
  return body.nodes;
}

function seedNote(collectionId, overrides = {}) {
  return db.createNote({
    collection_id: collectionId,
    denomination: '1',
    issue_date: '2020',
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

test('PUT /api/nodes/order reorders a parent\'s notes and groupings together', async () => {
  const showcase = await createShowcase('Reorder children');
  const category = await placeCategory(showcase.id, 'Order');
  const grouping = await addGrouping(showcase.id, category.id, 'Group A');
  const collection = db.createCollection('Reorder notes');
  const noteA = seedNote(collection.id, { denomination: 'A' });
  const noteB = seedNote(collection.id, { denomination: 'B' });
  const added = await addNotes(showcase.id, category.id, [noteA.id, noteB.id]);

  const ids = [grouping.id, ...added.map((node) => node.id)];
  const reversed = [...ids].reverse();

  const { response, body } = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({
      showcase_id: showcase.id,
      parent_node_id: category.id,
      node_ids: reversed
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.nodes.map((node) => node.id), reversed);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  const children = tree.nodes.find((node) => node.name === 'Order').children;
  assert.deepEqual(children.map((node) => node.id), reversed);
  assert.deepEqual(children.map((node) => node.position), [1, 2, 3]);
});

test('PUT /api/nodes/order rejects anything but a full permutation', async () => {
  const showcase = await createShowcase('Reorder guards');
  const category = await placeCategory(showcase.id, 'Guards');
  const first = await addGrouping(showcase.id, category.id, 'First');
  const second = await addGrouping(showcase.id, category.id, 'Second');

  const partial = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({
      showcase_id: showcase.id,
      parent_node_id: category.id,
      node_ids: [first.id]
    })
  });
  assert.equal(partial.response.status, 400);
  assert.match(partial.body.error, /exactly once/i);

  const foreign = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({
      showcase_id: showcase.id,
      parent_node_id: category.id,
      node_ids: [second.id, 999999]
    })
  });
  assert.equal(foreign.response.status, 400);
  assert.match(foreign.body.error, /exactly once/i);

  const missingIds = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({ showcase_id: showcase.id, parent_node_id: category.id })
  });
  assert.equal(missingIds.response.status, 400);
});

test('PUT /api/nodes/order reorders the top level when the parent is null', async () => {
  const showcase = await createShowcase('Top order');
  const first = await placeCategory(showcase.id, 'Top A');
  const second = await placeCategory(showcase.id, 'Top B');

  const { response, body } = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({
      showcase_id: showcase.id,
      parent_node_id: null,
      node_ids: [second.id, first.id]
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body.nodes.map((node) => node.id), [second.id, first.id]);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(tree.nodes.map((node) => node.id), [second.id, first.id]);
});

test('PUT /api/nodes/order rejects an unknown showcase or parent', async () => {
  const unknownShowcase = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({ showcase_id: 999999, parent_node_id: null, node_ids: [] })
  });
  assert.equal(unknownShowcase.response.status, 400);
  assert.match(unknownShowcase.body.error, /showcase/i);

  const showcase = await createShowcase('Unknown parent');
  await placeCategory(showcase.id, 'Parent');

  const unknownParent = await api('/api/nodes/order', {
    method: 'PUT',
    body: JSON.stringify({
      showcase_id: showcase.id,
      parent_node_id: 999999,
      node_ids: []
    })
  });
  assert.equal(unknownParent.response.status, 400);
  assert.match(unknownParent.body.error, /parent/i);
});

// Database seam --------------------------------------------------------------

test('reorderShowcaseNodes persists positions across a database reopen', () => {
  const showcase = db.createShowcase('Seam reopen');
  const category = db.createCategory('Seam reopen label');
  const categoryNode = db.addShowcaseNode(showcase.id, {
    type: 'category',
    category_id: category.id
  });
  const first = db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: categoryNode.id,
    name: 'First'
  });
  const second = db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: categoryNode.id,
    name: 'Second'
  });

  db.reorderShowcaseNodes(showcase.id, categoryNode.id, [second.id, first.id]);
  // A reopen rebuilds the prepared statements from the same file; the order
  // must survive because it lives in the `position` column.
  db.reloadDatabase();

  const tree = db.getShowcaseTree(showcase.id);
  assert.deepEqual(
    tree[0].children.map((node) => node.id),
    [second.id, first.id]
  );

  assert.throws(
    () => db.reorderShowcaseNodes(showcase.id, categoryNode.id, [second.id]),
    /exactly once/i
  );
});
