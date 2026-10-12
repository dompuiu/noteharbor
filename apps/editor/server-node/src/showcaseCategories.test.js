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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-showcase-categories-'));
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

// The label pool API ---------------------------------------------------------

test('GET /api/categories lists the label pool', async () => {
  const { response, body } = await api('/api/categories');

  assert.equal(response.status, 200);
  assert.deepEqual(body.categories, []);
});

test('POST /api/categories creates a label', async () => {
  const { response, body } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Themes' })
  });

  assert.equal(response.status, 201);
  assert.equal(body.category.name, 'Themes');
  assert.ok(body.category.id > 0);
});

test('POST /api/categories with an existing name returns it ignoring case', async () => {
  const first = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Shared' })
  });
  const second = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: '  sHaReD ' })
  });

  assert.equal(second.response.status, 201);
  assert.equal(second.body.category.id, first.body.category.id);
  assert.equal(second.body.category.name, 'Shared');

  const { body } = await api('/api/categories');
  const shared = body.categories.filter((category) => category.name === 'Shared');
  assert.equal(shared.length, 1);
});

test('POST /api/categories rejects a blank name', async () => {
  const { response, body } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: '   ' })
  });

  assert.equal(response.status, 400);
  assert.equal(body.error, 'Category name is required.');
});

test('PUT /api/categories/:id renames a label', async () => {
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Old name' })
  });

  const { response, body } = await api(`/api/categories/${created.category.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'New name' })
  });

  assert.equal(response.status, 200);
  assert.equal(body.category.name, 'New name');

  const { body: list } = await api('/api/categories');
  assert.ok(list.categories.some((category) => category.name === 'New name'));
  assert.ok(!list.categories.some((category) => category.name === 'Old name'));
});

test('PUT /api/categories/:id reports a missing label', async () => {
  const { response, body } = await api('/api/categories/999999', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Nope' })
  });

  assert.equal(response.status, 404);
  assert.equal(body.error, 'Category not found.');
});

// The tree and node APIs -----------------------------------------------------

test('GET /api/showcases/:id/tree returns an empty tree for a fresh showcase', async () => {
  const showcase = await createShowcase('Tree empty');
  const { response, body } = await api(`/api/showcases/${showcase.id}/tree`);

  assert.equal(response.status, 200);
  assert.equal(body.showcase_id, showcase.id);
  assert.deepEqual(body.nodes, []);
});

test('GET /api/showcases/:id/tree reports a missing showcase', async () => {
  const { response, body } = await api('/api/showcases/999999/tree');

  assert.equal(response.status, 404);
  assert.equal(body.error, 'Showcase not found.');
});

test('POST /api/showcases/:id/nodes places a category by name', async () => {
  const showcase = await createShowcase('Named placement');
  const { response, body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'category', name: 'Anniversary' })
  });

  assert.equal(response.status, 201);
  assert.equal(body.node.node_type, 'category');
  assert.equal(body.node.name, 'Anniversary');
  assert.equal(body.node.parent_node_id, null);
  assert.deepEqual(body.node.children, []);

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.equal(tree.nodes.length, 1);
  assert.equal(tree.nodes[0].name, 'Anniversary');
});

test('POST /api/showcases/:id/nodes places a category by an existing label id', async () => {
  const showcase = await createShowcase('Referenced placement');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Referenced' })
  });

  const { body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'category',
      category_id: created.category.id
    })
  });

  assert.equal(body.node.category_id, created.category.id);
  assert.equal(body.node.name, 'Referenced');
});

test('a category label appears at most once per showcase', async () => {
  const showcase = await createShowcase('No duplicates');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Once' })
  });

  const payload = {
    type: 'category',
    category_id: created.category.id
  };

  const first = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  const second = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 400);
  assert.match(second.body.error, /already in the showcase/i);
});

test('the same label can be placed in several showcases', async () => {
  const first = await createShowcase('Shared A');
  const second = await createShowcase('Shared B');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Across showcases' })
  });
  const payload = JSON.stringify({
    type: 'category',
    category_id: created.category.id
  });

  const a = await api(`/api/showcases/${first.id}/nodes`, {
    method: 'POST',
    body: payload
  });
  const b = await api(`/api/showcases/${second.id}/nodes`, {
    method: 'POST',
    body: payload
  });

  assert.equal(a.response.status, 201);
  assert.equal(b.response.status, 201);
});

test('a category placement is top level only', async () => {
  const showcase = await createShowcase('Top level only');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Must be top' })
  });

  const { response, body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'category',
      category_id: created.category.id,
      parent_id: 123
    })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /top level/i);
});

test('POST /api/showcases/:id/nodes rejects an unknown type', async () => {
  const showcase = await createShowcase('Unknown type');
  const { response, body } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({ type: 'wat', name: 'Nope' })
  });

  assert.equal(response.status, 400);
  assert.match(body.error, /node type/i);
});

test('the tree orders nodes by position then id', async () => {
  const showcase = await createShowcase('Position order');
  const database = db.getDatabase();
  const insert = database.prepare(`
    INSERT INTO categories (name) VALUES (?)
  `);
  const insertNode = database.prepare(`
    INSERT INTO showcase_nodes (showcase_id, node_type, category_id, position)
    VALUES (?, 'category', ?, ?)
  `);

  for (const [name, position] of [
    ['Second', 2],
    ['First', 1],
    ['Tie a', 3],
    ['Tie b', 3]
  ]) {
    const categoryId = Number(insert.run(name).lastInsertRowid);
    insertNode.run(showcase.id, categoryId, position);
  }

  const { body } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(
    body.nodes.map((node) => node.name),
    ['First', 'Second', 'Tie a', 'Tie b']
  );
});

test('PUT /api/nodes/:id renames a category placement by renaming the label', async () => {
  const first = await createShowcase('Rename A');
  const second = await createShowcase('Rename B');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Before' })
  });
  const payload = JSON.stringify({
    type: 'category',
    category_id: created.category.id
  });

  const { body: placed } = await api(`/api/showcases/${first.id}/nodes`, {
    method: 'POST',
    body: payload
  });
  await api(`/api/showcases/${second.id}/nodes`, { method: 'POST', body: payload });

  const { response, body } = await api(`/api/nodes/${placed.node.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'After' })
  });

  assert.equal(response.status, 200);
  assert.equal(body.node.name, 'After');

  const { body: treeA } = await api(`/api/showcases/${first.id}/tree`);
  const { body: treeB } = await api(`/api/showcases/${second.id}/tree`);
  assert.equal(treeA.nodes[0].name, 'After');
  assert.equal(treeB.nodes[0].name, 'After');
});

test('PUT /api/nodes/:id reports a missing node', async () => {
  const { response, body } = await api('/api/nodes/999999', {
    method: 'PUT',
    body: JSON.stringify({ name: 'Nope' })
  });

  assert.equal(response.status, 404);
  assert.equal(body.error, 'Node not found.');
});

test('DELETE /api/nodes/:id removes a placement and keeps the label', async () => {
  const showcase = await createShowcase('Remove placement');
  const { body: created } = await api('/api/categories', {
    method: 'POST',
    body: JSON.stringify({ name: 'Keep me' })
  });
  const { body: placed } = await api(`/api/showcases/${showcase.id}/nodes`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'category',
      category_id: created.category.id
    })
  });

  const { response, body } = await api(`/api/nodes/${placed.node.id}`, {
    method: 'DELETE'
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true });

  const { body: tree } = await api(`/api/showcases/${showcase.id}/tree`);
  assert.deepEqual(tree.nodes, []);

  const { body: pool } = await api('/api/categories');
  assert.ok(pool.categories.some((category) => category.name === 'Keep me'));
});

test('DELETE /api/nodes/:id reports a missing node', async () => {
  const { response } = await api('/api/nodes/999999', { method: 'DELETE' });
  assert.equal(response.status, 404);
});

// Database seam --------------------------------------------------------------

test('the partial unique index blocks a second placement at the database seam', () => {
  const showcase = db.createShowcase('Index seam');
  const category = db.createCategory('Indexed label');
  const database = db.getDatabase();
  const insert = database.prepare(`
    INSERT INTO showcase_nodes (showcase_id, node_type, category_id, position)
    VALUES (?, 'category', ?, ?)
  `);

  insert.run(showcase.id, category.id, 1);

  assert.throws(
    () => insert.run(showcase.id, category.id, 2),
    /UNIQUE constraint failed/
  );
});

test('deleting a node cascades its subtree and keeps the label', () => {
  const showcase = db.createShowcase('Cascade seam');
  const category = db.createCategory('Cascade label');
  const database = db.getDatabase();

  const categoryNode = db.addShowcaseNode(showcase.id, {
    type: 'category',
    category_id: category.id
  });

  const insertChild = database.prepare(`
    INSERT INTO showcase_nodes (showcase_id, parent_node_id, node_type, name, position)
    VALUES (@showcase_id, @parent_node_id, 'grouping', @name, @position)
  `);
  const child = insertChild.run({
    showcase_id: showcase.id,
    parent_node_id: categoryNode.id,
    name: 'Child',
    position: 1
  });
  insertChild.run({
    showcase_id: showcase.id,
    parent_node_id: Number(child.lastInsertRowid),
    name: 'Grandchild',
    position: 1
  });

  assert.equal(db.deleteShowcaseNode(categoryNode.id), true);

  const remaining = database
    .prepare('SELECT COUNT(*) AS value FROM showcase_nodes WHERE showcase_id = ?')
    .get(showcase.id);
  assert.equal(remaining.value, 0);

  const label = database
    .prepare('SELECT name FROM categories WHERE id = ?')
    .get(category.id);
  assert.equal(label.name, 'Cascade label');

  assert.equal(db.deleteShowcaseNode(categoryNode.id), false);
});
