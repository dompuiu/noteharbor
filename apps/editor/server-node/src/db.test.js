import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrateBanknotesForeignKey } from './db.js';

function createLegacyDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-db-migration-'));
  const dbPath = path.join(dir, 'banknotes.db');
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE collections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
      CREATE TABLE banknotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER,
        display_order INTEGER,
        denomination TEXT,
        images TEXT
      );
    `);
    db.prepare(`INSERT INTO collections (id, name) VALUES (1, 'Kept')`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, denomination) VALUES (1, 1, '10 Lei')`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, denomination) VALUES (2, 999, '20 Lei')`).run();
  } finally {
    db.close();
  }
  return { dir, dbPath };
}

test('legacy banknotes tables gain the cascade foreign key without losing rows', () => {
  const { dir, dbPath } = createLegacyDatabase();
  try {
    const db = new Database(dbPath);
    try {
      assert.equal(db.prepare(`PRAGMA foreign_key_list(banknotes)`).all().length, 0);
      migrateBanknotesForeignKey(db);
      const keys = db.prepare(`PRAGMA foreign_key_list(banknotes)`).all();
      assert.equal(keys.length, 1);
      assert.equal(keys[0].table, 'collections');
      assert.equal(keys[0].on_delete, 'CASCADE');
      assert.equal(db.prepare(`SELECT COUNT(*) AS value FROM banknotes`).get().value, 2);

      db.pragma('foreign_keys = ON');
      db.prepare(`DELETE FROM collections WHERE id = 1`).run();
      const remaining = db.prepare(`SELECT id FROM banknotes ORDER BY id`).all().map((row) => row.id);
      assert.deepEqual(remaining, [2]);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('migration is a no-op when the foreign key already exists', () => {
  const { dir, dbPath } = createLegacyDatabase();
  try {
    const db = new Database(dbPath);
    try {
      migrateBanknotesForeignKey(db);
      migrateBanknotesForeignKey(db);
      assert.equal(db.prepare(`SELECT COUNT(*) AS value FROM banknotes`).get().value, 2);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
