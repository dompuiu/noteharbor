import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-collections-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  db = await import('./db.js');
});

after(() => {
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function manualNames() {
  return db
    .getAllCollections()
    .filter((collection) => collection.name.startsWith('Manual '))
    .map((collection) => collection.name);
}

function notePayload(collectionId) {
  return {
    collection_id: collectionId,
    denomination: '',
    issue_date: '',
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
  };
}

test('collections keep a manual order: new rows append and nothing re-sorts them', () => {
  const second = db.createCollection('Manual Second');
  db.createCollection('Manual First');
  db.createCollection('Manual Third');

  // Created order is insertion order, so "Second" precedes the later "First".
  assert.deepEqual(manualNames(), ['Manual Second', 'Manual First', 'Manual Third']);

  // There is no default flag anymore; rows carry no is_default property.
  for (const collection of db.getAllCollections()) {
    assert.equal('is_default' in collection, false);
  }

  const allIds = db.getAllCollections().map((collection) => collection.id);
  const reversed = [...allIds].reverse();

  assert.deepEqual(
    db.reorderCollections(reversed).map((collection) => collection.id),
    reversed
  );

  assert.equal(second.name, 'Manual Second');
});

test('getFirstCollectionId resolves the top sidebar collection after a reorder', () => {
  const a = db.createCollection('First Pick A');
  const b = db.createCollection('First Pick B');
  const ids = db.getAllCollections().map((collection) => collection.id);

  db.reorderCollections([b.id, a.id, ...ids.filter((id) => id !== a.id && id !== b.id)]);

  // Sidebar order wins over insertion (and id) order.
  assert.equal(db.getFirstCollectionId(), b.id);
});

test('getAllCollections reports how many notes each collection holds', () => {
  const a = db.createCollection('Counts A');
  const b = db.createCollection('Counts B');

  db.createNote(notePayload(a.id));
  db.createNote(notePayload(a.id));
  db.createNote(notePayload(b.id));

  const counts = new Map(
    db.getAllCollections().map((collection) => [collection.id, collection.note_count])
  );

  assert.equal(counts.get(a.id), 2);
  assert.equal(counts.get(b.id), 1);
});

test('createCollection with an omitted name picks a unique default', () => {
  const first = db.createCollection(undefined);
  const second = db.createCollection('');
  const third = db.createCollection('   ');

  assert.equal(first.name, 'Collection');
  assert.equal(second.name, 'Collection 2');
  assert.equal(third.name, 'Collection 3');
  assert.notEqual(first.id, second.id);
});

test('reorderCollections rejects lists that are not a full permutation', () => {
  const ids = db.getAllCollections().map((collection) => collection.id);

  assert.throws(
    () => db.reorderCollections([ids[0]]),
    /every collection exactly once/
  );
  assert.throws(
    () => db.reorderCollections([...ids, ids[0]]),
    /every collection exactly once/
  );
  assert.throws(
    () => db.reorderCollections([ids[0], ids[0], ...ids.slice(2)]),
    /every collection exactly once/
  );
  assert.throws(
    () => db.reorderCollections([]),
    /every collection exactly once/
  );
});

test('legacy collections gain a display_order without losing their row order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-legacy-collections-'));
  const dbPath = path.join(dir, 'banknotes.db');
  const Database = (await import('better-sqlite3')).default;

  const legacy = new Database(dbPath);
  try {
    legacy.exec(`
      CREATE TABLE collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    legacy.prepare(`INSERT INTO collections (id, name, is_default) VALUES (10, 'Old B', 0)`).run();
    legacy.prepare(`INSERT INTO collections (id, name, is_default) VALUES (11, 'Old A', 1)`).run();
    legacy.prepare(`INSERT INTO collections (id, name, is_default) VALUES (12, 'Old C', 0)`).run();
  } finally {
    legacy.close();
  }

  const previousDataDir = process.env.NOTE_HARBOR_DATA_DIR;
  process.env.NOTE_HARBOR_DATA_DIR = dir;
  let legacyDb;

  try {
    legacyDb = await import(`./db.js?legacy=${Date.now()}`);
    const ordered = legacyDb.getAllCollections().map((collection) => collection.name);

    // Backfill follows id order, not name order.
    assert.deepEqual(ordered, ['Old B', 'Old A', 'Old C']);

    // The retired default flag is dropped by the migration, whatever the
    // old rows carried.
    const columns = legacyDb.getDatabase().prepare(`PRAGMA table_info(collections)`).all();
    assert.equal(columns.some((column) => column.name === 'is_default'), false);
    for (const collection of legacyDb.getAllCollections()) {
      assert.equal('is_default' in collection, false);
    }
  } finally {
    legacyDb?.closeDatabase();
    process.env.NOTE_HARBOR_DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
