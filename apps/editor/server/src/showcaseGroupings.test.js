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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-showcase-groupings-'));
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
  return api(`/api/showcases/${showcaseId}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'grouping', parent_id: parentId, name })
  });
}

test('POST /api/showcases/:id/nodes adds a grouping under a category placement', async () => {
  const showcase = await createShowcase('Grouping parent');
  const category = await placeCategory(showcase.id, 'Themes');

  const { response, body } = await addGrouping(showcase.id, category.id, 'Sub group');

  assert.equal(response.status, 201);
  assert.equal(body.node.node_type, 'grouping');
  assert.equal(body.node.name, 'Sub group');
  assert.equal(body.node.parent_node_id, category.id);
  assert.equal(body.node.category_id, null);
  assert.equal(body.node.note_id, null);
  assert.equal(body.node.cover_note_id, null);
  assert.deepEqual(body.node.children, []);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes.length, 1);
  assert.equal(tree.nodes[0].children.length, 1);
  assert.equal(tree.nodes[0].children[0].name, 'Sub group');
});

test('POST /api/showcases/:id/nodes nests a grouping inside another grouping', async () => {
  const showcase = await createShowcase('Nested grouping');
  const category = await placeCategory(showcase.id, 'Nested');
  const { body: outer } = await addGrouping(showcase.id, category.id, 'Outer');

  const { response, body } = await addGrouping(showcase.id, outer.node.id, 'Inner');

  assert.equal(response.status, 201);
  assert.equal(body.node.parent_node_id, outer.node.id);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes[0].children[0].name, 'Outer');
  assert.equal(tree.nodes[0].children[0].children[0].name, 'Inner');
});

test('a grouping requires a parent, a name, and a valid parent', async () => {
  const showcase = await createShowcase('Grouping guards');
  const category = await placeCategory(showcase.id, 'Guards');

  const noParent = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'grouping', name: 'Orphan' })
  });
  assert.equal(noParent.response.status, 400);
  assert.match(noParent.body.error, /parent/i);

  const noName = await addGrouping(showcase.id, category.id, '   ');
  assert.equal(noName.response.status, 400);
  assert.match(noName.body.error, /name/i);

  const unknownParent = await addGrouping(showcase.id, 999999, 'Nowhere');
  assert.equal(unknownParent.response.status, 400);
  assert.match(unknownParent.body.error, /parent/i);
});

test('a grouping cannot be nested under a note', async () => {
  const showcase = await createShowcase('Under a note');
  const database = db.getDatabase();
  const noteNode = database
    .prepare(`
      INSERT INTO showcase_nodes (showcase_id, node_type, position)
      VALUES (?, 'note', 1)
    `)
    .run(showcase.id);

  const { response, body } = await addGrouping(
    showcase.id,
    Number(noteNode.lastInsertRowid),
    'Not here'
  );

  assert.equal(response.status, 400);
  assert.match(body.error, /note/i);
});

test('a grouping is local to its parent placement', async () => {
  const showcase = await createShowcase('Local placement');
  const first = await placeCategory(showcase.id, 'First');
  const second = await placeCategory(showcase.id, 'Second');
  const { body: grouped } = await addGrouping(showcase.id, first.id, 'In first');

  await api(`/api/nodes/${grouped.node.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'Renamed first' })
  });

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  const firstPlacement = tree.nodes.find((node) => node.name === 'First');
  const secondPlacement = tree.nodes.find((node) => node.name === 'Second');
  assert.deepEqual(
    firstPlacement.children.map((node) => node.name),
    ['Renamed first']
  );
  assert.deepEqual(secondPlacement.children, []);
});

test('a grouping never leaks to another showcase', async () => {
  const first = await createShowcase('Leak first');
  const second = await createShowcase('Leak second');
  const firstPlacement = await placeCategory(first.id, 'Shared label');
  await placeCategory(second.id, 'Shared label');

  await addGrouping(first.id, firstPlacement.id, 'Only in first');

  const { body: tree } = await api(`/api/showcases/${second.id}/tree`);
  assert.deepEqual(tree.nodes[0].children, []);
});

test('PUT /api/nodes/:id renames a grouping without touching the label pool', async () => {
  const showcase = await createShowcase('Rename grouping');
  const category = await placeCategory(showcase.id, 'Rename parent');
  const { body: grouped } = await addGrouping(showcase.id, category.id, 'Before');

  const { response, body } = await api(`/api/nodes/${grouped.node.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: '  After  ' })
  });

  assert.equal(response.status, 200);
  assert.equal(body.node.name, 'After');

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes[0].children[0].name, 'After');
});

test('DELETE /api/nodes/:id removes a grouping and its subtree', async () => {
  const showcase = await createShowcase('Delete grouping');
  const category = await placeCategory(showcase.id, 'Delete parent');
  const { body: outer } = await addGrouping(showcase.id, category.id, 'Outer');
  await addGrouping(showcase.id, outer.node.id, 'Inner');

  const { response, body } = await api(`/api/nodes/${outer.node.id}`, {
    method: 'DELETE'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true });

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(tree.nodes[0].children, []);
});

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

test('PUT /api/nodes/:id sets a grouping cover and null clears it', async () => {
  const showcase = await createShowcase('Grouping cover');
  const category = await placeCategory(showcase.id, 'Cover parent');
  const { body: grouped } = await addGrouping(showcase.id, category.id, 'Cover group');
  const collection = db.createCollection('Cover notes');
  const note = seedNote(collection.id);

  const set = await api(`/api/nodes/${grouped.node.id}`, {
    method: 'PUT',
    body: JSON.stringify({ cover_note_id: note.id })
  });

  assert.equal(set.response.status, 200);
  assert.equal(set.body.node.cover_note_id, note.id);
  assert.equal(set.body.node.cover_note?.id, note.id);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes[0].children[0].cover_note_id, note.id);
  assert.equal(tree.nodes[0].children[0].cover_note?.id, note.id);

  const clear = await api(`/api/nodes/${grouped.node.id}`, {
    method: 'PUT',
    body: JSON.stringify({ cover_note_id: null })
  });

  assert.equal(clear.response.status, 200);
  assert.equal(clear.body.node.cover_note_id, null);
  assert.equal(clear.body.node.cover_note, null);
});

// Database seam --------------------------------------------------------------

test('deleting a grouping at the database seam removes its whole subtree', () => {
  const showcase = db.createShowcase('Seam cascade');
  const category = db.createCategory('Seam cascade label');
  const categoryNode = db.addShowcaseNode(showcase.id, {
    type: 'category',
    category_id: category.id
  });
  const outer = db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: categoryNode.id,
    name: 'Outer'
  });
  const inner = db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: outer.id,
    name: 'Inner'
  });
  db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: inner.id,
    name: 'Leaf'
  });

  assert.equal(db.deleteShowcaseNode(outer.id), true);

  const remaining = db
    .getDatabase()
    .prepare('SELECT COUNT(*) AS value FROM showcase_nodes WHERE showcase_id = ?')
    .get(showcase.id);
  assert.equal(remaining.value, 1);
});

test('deleting a cover note nulls the manual cover at the database seam', () => {
  const showcase = db.createShowcase('Seam cover');
  const category = db.createCategory('Seam cover label');
  const categoryNode = db.addShowcaseNode(showcase.id, {
    type: 'category',
    category_id: category.id
  });
  const grouping = db.addShowcaseNode(showcase.id, {
    type: 'grouping',
    parent_id: categoryNode.id,
    name: 'Covered'
  });
  const collection = db.createCollection('Seam cover notes');
  const note = seedNote(collection.id);

  db.updateShowcaseNode(grouping.id, { cover_note_id: note.id });

  let groupingNode = db.getShowcaseTree(showcase.id)[0].children[0];
  assert.equal(groupingNode.cover_note_id, note.id);
  assert.equal(groupingNode.cover_note.id, note.id);

  db.deleteNote(note.id, collection.id);

  groupingNode = db.getShowcaseTree(showcase.id)[0].children[0];
  assert.equal(groupingNode.cover_note_id, null);
  assert.equal(groupingNode.cover_note, null);
});
