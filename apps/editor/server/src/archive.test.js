import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mergeArchiveIntoStagedData } from './routes/archive.js';

function createLegacyStagedDataDir() {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-archive-test-'));
  const stagedDataDir = path.join(stageRoot, 'data');
  const stagedImagesDir = path.join(stagedDataDir, 'images', 'notes', '1');
  fs.mkdirSync(stagedImagesDir, { recursive: true });

  const stagedDbPath = path.join(stagedDataDir, 'banknotes.db');
  const db = new Database(stagedDbPath);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE banknotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER,
        display_order INTEGER,
        denomination TEXT,
        issue_date TEXT,
        catalog_number TEXT,
        grading_company TEXT,
        grade TEXT,
        watermark TEXT,
        serial TEXT,
        url TEXT,
        notes TEXT,
        scraped_data TEXT,
        images TEXT,
        scrape_status TEXT DEFAULT 'pending',
        scrape_error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE
      );
      CREATE TABLE banknote_tags (
        banknote_id INTEGER NOT NULL REFERENCES banknotes(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (banknote_id, tag_id)
      );
    `);
    db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (1, 'Serban''s Notes', 0)`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (1, 1, 1, '10 Lei', '[]')`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (2, 1, 2, '20 Lei', '[]')`).run();
    db.prepare(`INSERT INTO tags (id, name, collection_id) VALUES (1, 'old-tag', 1)`).run();
    db.prepare(`INSERT INTO banknote_tags (banknote_id, tag_id) VALUES (1, 1)`).run();
  } finally {
    db.close();
  }

  fs.writeFileSync(path.join(stagedImagesDir, 'front-full.jpg'), 'staged-image');
  return { stageRoot, stagedDataDir };
}

function createArchiveDataDir() {
  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-archive-src-'));
  const archiveDataDir = path.join(archiveRoot, 'data');
  const archiveImagesDir = path.join(archiveDataDir, 'images', 'notes', '5');
  fs.mkdirSync(archiveImagesDir, { recursive: true });

  const archiveDbPath = path.join(archiveDataDir, 'banknotes.db');
  const db = new Database(archiveDbPath);
  try {
    db.exec(`
      CREATE TABLE collections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE banknotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER,
        display_order INTEGER,
        denomination TEXT,
        issue_date TEXT,
        catalog_number TEXT,
        grading_company TEXT,
        grade TEXT,
        watermark TEXT,
        serial TEXT,
        url TEXT,
        notes TEXT,
        scraped_data TEXT,
        images TEXT,
        scrape_status TEXT DEFAULT 'pending',
        scrape_error TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL);
      CREATE TABLE banknote_tags (banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (banknote_id, tag_id));
    `);
    db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (5, 'Serban''s Notes', 0)`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (5, 5, 1, '100 Lei', '[]')`).run();
  } finally {
    db.close();
  }

  return { archiveRoot, archiveDataDir };
}

test('re-importing a same-named collection leaves no orphaned notes, tags or links', () => {
  const { stageRoot, stagedDataDir } = createLegacyStagedDataDir();
  const { archiveRoot, archiveDataDir } = createArchiveDataDir();

  try {
    mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir);

    const db = new Database(path.join(stagedDataDir, 'banknotes.db'), { readonly: true });
    try {
      const orphanNotes = db
        .prepare(
          `SELECT COUNT(*) AS value FROM banknotes b LEFT JOIN collections c ON c.id = b.collection_id WHERE c.id IS NULL`
        )
        .get().value;
      assert.equal(orphanNotes, 0);

      const totalNotes = db.prepare(`SELECT COUNT(*) AS value FROM banknotes`).get().value;
      assert.equal(totalNotes, 1);

      const orphanLinks = db
        .prepare(
          `SELECT COUNT(*) AS value FROM banknote_tags bt LEFT JOIN banknotes b ON b.id = bt.banknote_id LEFT JOIN tags t ON t.id = bt.tag_id WHERE b.id IS NULL OR t.id IS NULL`
        )
        .get().value;
      assert.equal(orphanLinks, 0);

      const remainingTags = db.prepare(`SELECT COUNT(*) AS value FROM tags`).get().value;
      assert.equal(remainingTags, 0);
    } finally {
      db.close();
    }

    assert.equal(fs.existsSync(path.join(stagedDataDir, 'images', 'notes', '1')), false);
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});
