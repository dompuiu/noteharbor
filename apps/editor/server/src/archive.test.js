import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { mergeArchiveIntoStagedData, renumberSnapshot, sanitizeSnapshotImages } from './routes/archive.js';

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

function createDirtySnapshotDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE banknotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER,
      display_order INTEGER,
      denomination TEXT,
      images TEXT
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      collection_id INTEGER NOT NULL
    );
    CREATE TABLE banknote_tags (
      banknote_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (banknote_id, tag_id)
    );
  `);
  db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (10, 'A', 1), (25, 'B', 0)`).run();
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, ?)`).run(
    100, 10, 5, '10 Lei',
    JSON.stringify([
      { type: 'front', variant: 'full', localPath: '/api/images/notes/100/front-full.jpg', origin: 'scraped' },
      { type: 'front', variant: 'thumbnail', localPath: '/api/images/notes/100/front-thumbnail.jpg', origin: 'scraped' }
    ])
  );
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, ?)`).run(
    300, 10, 1, '20 Lei',
    JSON.stringify([{ type: 'back', variant: 'full', localPath: '/api/images/notes/300/back-full.jpg', origin: 'uploaded' }])
  );
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, ?)`).run(
    200, 25, 3, '5 Lei',
    JSON.stringify([{ type: 'front', variant: 'full', localPath: '/api/images/notes/200/front-full.jpg', origin: 'uploaded' }])
  );
  db.prepare(`INSERT INTO tags (id, name, collection_id) VALUES (50, 't1', 10), (60, 't2', 25)`).run();
  db.prepare(`INSERT INTO banknote_tags (banknote_id, tag_id) VALUES (100, 50), (300, 50), (200, 60)`).run();
  db.pragma('foreign_keys = ON');
  return db;
}

test('export sanitize drops thumbnail records and renumbers PKs from 1', () => {
  const db = createDirtySnapshotDatabase();

  try {
    sanitizeSnapshotImages(db);

    const dirtyImages = db.prepare(`SELECT images FROM banknotes WHERE id = 100`).get().images;
    assert.ok(!String(dirtyImages).includes('thumbnail'));

    const { copyPlan } = renumberSnapshot(db);

    assert.deepEqual(db.prepare(`SELECT id FROM collections ORDER BY id`).all().map((row) => row.id), [1, 2]);
    assert.deepEqual(db.prepare(`SELECT id, collection_id, display_order FROM banknotes ORDER BY id`).all(), [
      { id: 1, collection_id: 1, display_order: 1 },
      { id: 2, collection_id: 1, display_order: 2 },
      { id: 3, collection_id: 2, display_order: 1 }
    ]);
    assert.deepEqual(db.prepare(`SELECT denomination FROM banknotes ORDER BY id`).all().map((row) => row.denomination), [
      '20 Lei', '10 Lei', '5 Lei'
    ]);
    assert.deepEqual(db.prepare(`SELECT id, collection_id FROM tags ORDER BY id`).all(), [
      { id: 1, collection_id: 1 },
      { id: 2, collection_id: 2 }
    ]);
    assert.deepEqual(db.prepare(`SELECT banknote_id, tag_id FROM banknote_tags ORDER BY banknote_id`).all(), [
      { banknote_id: 1, tag_id: 1 },
      { banknote_id: 2, tag_id: 1 },
      { banknote_id: 3, tag_id: 2 }
    ]);

    const noteImages = db.prepare(`SELECT images FROM banknotes ORDER BY id`).all().map((row) => row.images);
    assert.ok(noteImages[0].includes('/api/images/notes/1/back-full.jpg'));
    assert.ok(noteImages[1].includes('/api/images/notes/2/front-full.jpg'));
    assert.ok(noteImages[2].includes('/api/images/notes/3/front-full.jpg'));
    assert.ok(noteImages.every((images) => !images.includes('thumbnail')));

    const copyTargets = copyPlan.map((entry) => entry.toRelativePath).sort();
    assert.deepEqual(copyTargets, [
      'notes/1/back-full.jpg',
      'notes/2/front-full.jpg',
      'notes/3/front-full.jpg'
    ]);

    assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), []);
  } finally {
    db.close();
  }
});

test('importing a legacy archive with thumbnails stores only full images', () => {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-thumb-stage-'));
  const stagedDataDir = path.join(stageRoot, 'data');
  fs.mkdirSync(path.join(stagedDataDir, 'images'), { recursive: true });
  const stagedDb = new Database(path.join(stagedDataDir, 'banknotes.db'));
  stagedDb.pragma('foreign_keys = OFF');
  stagedDb.exec(`
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE banknotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER, display_order INTEGER,
      denomination TEXT, issue_date TEXT, catalog_number TEXT, grading_company TEXT, grade TEXT,
      watermark TEXT, serial TEXT, url TEXT, notes TEXT, scraped_data TEXT, images TEXT,
      scrape_status TEXT DEFAULT 'pending', scrape_error TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL);
    CREATE TABLE banknote_tags (banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (banknote_id, tag_id));
  `);
  stagedDb.close();

  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-thumb-src-'));
  const archiveDataDir = path.join(archiveRoot, 'data');
  const archiveNoteImagesDir = path.join(archiveDataDir, 'images', 'notes', '5');
  fs.mkdirSync(archiveNoteImagesDir, { recursive: true });
  const archiveDb = new Database(path.join(archiveDataDir, 'banknotes.db'));
  archiveDb.exec(`
    CREATE TABLE collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE banknotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER, display_order INTEGER,
      denomination TEXT, issue_date TEXT, catalog_number TEXT, grading_company TEXT, grade TEXT,
      watermark TEXT, serial TEXT, url TEXT, notes TEXT, scraped_data TEXT, images TEXT,
      scrape_status TEXT DEFAULT 'pending', scrape_error TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL);
    CREATE TABLE banknote_tags (banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (banknote_id, tag_id));
  `);
  archiveDb.prepare(`INSERT INTO collections (id, name, is_default) VALUES (5, 'Legacy', 0)`).run();
  archiveDb.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, ?)`).run(
    5, 5, 1, '100 Lei',
    JSON.stringify([
      { type: 'front', variant: 'full', localPath: '/api/images/notes/5/front-full.jpg', origin: 'scraped' },
      { type: 'front', variant: 'thumbnail', localPath: '/api/images/notes/5/front-thumbnail.jpg', origin: 'scraped' }
    ])
  );
  archiveDb.close();
  fs.writeFileSync(path.join(archiveNoteImagesDir, 'front-full.jpg'), 'full-image');
  fs.writeFileSync(path.join(archiveNoteImagesDir, 'front-thumbnail.jpg'), 'thumbnail-image');

  try {
    mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir);

    const db = new Database(path.join(stagedDataDir, 'banknotes.db'), { readonly: true });
    try {
      const images = db.prepare(`SELECT images FROM banknotes`).get().images;
      assert.ok(images.includes('front-full'));
      assert.ok(!images.includes('thumbnail'));
    } finally {
      db.close();
    }

    const stagedNoteDirs = fs.readdirSync(path.join(stagedDataDir, 'images', 'notes'));
    assert.equal(stagedNoteDirs.length, 1);
    const stagedFiles = fs.readdirSync(path.join(stagedDataDir, 'images', 'notes', stagedNoteDirs[0]));
    assert.ok(stagedFiles.some((name) => name.startsWith('front-full.')));
    assert.ok(!stagedFiles.some((name) => name.includes('thumbnail')));
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});
