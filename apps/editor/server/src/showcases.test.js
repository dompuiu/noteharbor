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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-showcases-test-'));
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

function createShowcase(name) {
  return api('/api/showcases', {
    method: 'POST',
    body: JSON.stringify(name === undefined ? {} : { name })
  });
}

test('the migration adds the three showcase tables and their indexes', () => {
  const database = db.getDatabase();
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((row) => row.name);

  for (const table of ['categories', 'showcases', 'showcase_nodes']) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }

  const indexes = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
    .all()
    .map((row) => row.name);

  for (const index of [
    'idx_categories_name_nocase',
    'idx_showcases_name_nocase',
    'idx_showcases_display_order',
    'idx_showcase_nodes_category_once',
    'idx_showcase_nodes_parent'
  ]) {
    assert.ok(indexes.includes(index), `missing index ${index}`);
  }
});

test('the migration never changes the user version', () => {
  assert.equal(db.getDatabase().pragma('user_version', { simple: true }), 0);
});

test('POST /api/showcases creates a unique default name', async () => {
  const first = await createShowcase();
  const second = await createShowcase();

  assert.equal(first.response.status, 201);
  assert.equal(first.body.showcase.name, 'Showcase');
  assert.equal(second.body.showcase.name, 'Showcase 2');
  assert.notEqual(first.body.showcase.id, second.body.showcase.id);
});

test('re-opening the database keeps showcase rows and stays idempotent', async () => {
  const { body } = await createShowcase('Survives reload');
  const created = body.showcase;

  db.reloadDatabase();

  const rows = db.getAllShowcases();
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Showcase', 'Showcase 2', 'Survives reload']
  );
  assert.equal(rows.find((row) => row.id === created.id).name, 'Survives reload');
});

test('GET /api/showcases lists showcases in display order with a note count', async () => {
  // A dedicated showcase plus a note node so the count is meaningful.
  const { body } = await createShowcase('Counted');
  const showcaseId = body.showcase.id;

  const collection = db.createCollection('Showcase notes');
  const note = db.createNote({
    collection_id: collection.id,
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
    images: []
  });

  db.getDatabase().prepare(`
    INSERT INTO showcase_nodes (showcase_id, node_type, note_id, position)
    VALUES (?, 'note', ?, 1)
  `).run(showcaseId, note.id);

  const { response, body: payload } = await api('/api/showcases');
  assert.equal(response.status, 200);

  const names = payload.showcases.map((showcase) => showcase.name);
  const counted = payload.showcases.find((showcase) => showcase.id === showcaseId);
  const uncounted = payload.showcases.find((showcase) => showcase.name === 'Showcase');

  assert.equal(counted.note_count, 1);
  assert.equal(uncounted.note_count, 0);

  // Ordered by display_order, which is creation order here.
  assert.deepEqual(
    names,
    ['Showcase', 'Showcase 2', 'Survives reload', 'Counted']
  );
});

test('a category label can only be placed once in one showcase', async () => {
  const { body } = await createShowcase('Unique placements');
  const showcaseId = body.showcase.id;
  const database = db.getDatabase();

  database.prepare(`INSERT INTO categories (name) VALUES (?)`).run('Themes');
  const category = database
    .prepare(`SELECT id FROM categories WHERE name = ?`)
    .get('Themes');

  const insertPlacement = database.prepare(`
    INSERT INTO showcase_nodes (showcase_id, node_type, category_id, position)
    VALUES (?, 'category', ?, ?)
  `);
  insertPlacement.run(showcaseId, category.id, 1);

  assert.throws(
    () => insertPlacement.run(showcaseId, category.id, 2),
    /UNIQUE constraint failed/
  );
});
