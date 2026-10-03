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

test('collections keep a manual order: new rows append and defaults do not re-sort', () => {
  const second = db.createCollection('Manual Second');
  db.createCollection('Manual First');
  db.createCollection('Manual Third');

  // Created order is insertion order, so "Second" precedes the later "First".
  assert.deepEqual(manualNames(), ['Manual Second', 'Manual First', 'Manual Third']);

  db.setDefaultCollectionById(second.id);

  // Marking a default must not move it or anything else.
  assert.deepEqual(manualNames(), ['Manual Second', 'Manual First', 'Manual Third']);
  assert.equal(
    db.getAllCollections().find((collection) => collection.id === second.id).is_default,
    1
  );

  const allIds = db.getAllCollections().map((collection) => collection.id);
  const reversed = [...allIds].reverse();

  assert.deepEqual(
    db.reorderCollections(reversed).map((collection) => collection.id),
    reversed
  );
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
  } finally {
    legacyDb?.closeDatabase();
    process.env.NOTE_HARBOR_DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
