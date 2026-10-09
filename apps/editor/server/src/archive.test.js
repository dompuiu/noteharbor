import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  buildFilteredExportSnapshot,
  mergeArchiveIntoStagedData,
  renumberSnapshot,
  sanitizeSnapshotImages,
  stripScrapeColumns
} from './routes/archive.js';

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

test('export sanitize preserves thumbnail records and renumbers PKs from 1', () => {
  const db = createDirtySnapshotDatabase();

  try {
    sanitizeSnapshotImages(db);

    const dirtyImages = db.prepare(`SELECT images FROM banknotes WHERE id = 100`).get().images;
    assert.ok(String(dirtyImages).includes('thumbnail'));

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
    assert.ok(noteImages[1].includes('/api/images/notes/2/front-thumbnail.jpg'));
    assert.ok(noteImages[2].includes('/api/images/notes/3/front-full.jpg'));

    const copyTargets = copyPlan.map((entry) => entry.toRelativePath).sort();
    assert.deepEqual(copyTargets, [
      'notes/1/back-full.jpg',
      'notes/2/front-full.jpg',
      'notes/2/front-thumbnail.jpg',
      'notes/3/front-full.jpg'
    ]);

    assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), []);
  } finally {
    db.close();
  }
});

test('importing a legacy archive with thumbnails preserves all images', () => {
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
      assert.ok(images.includes('thumbnail'));
    } finally {
      db.close();
    }

    const stagedNoteDirs = fs.readdirSync(path.join(stagedDataDir, 'images', 'notes'));
    assert.equal(stagedNoteDirs.length, 1);
    const stagedFiles = fs.readdirSync(path.join(stagedDataDir, 'images', 'notes', stagedNoteDirs[0]));
    assert.ok(stagedFiles.some((name) => name.startsWith('front-full.')));
    assert.ok(stagedFiles.some((name) => name.includes('thumbnail')));
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test('importing an archive without scrape columns populates the staged note', () => {
  const { stageRoot, stagedDataDir } = createLegacyStagedDataDir();
  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-nocol-src-'));
  const archiveDataDir = path.join(archiveRoot, 'data');
  fs.mkdirSync(path.join(archiveDataDir, 'images'), { recursive: true });

  const archiveDb = new Database(path.join(archiveDataDir, 'banknotes.db'));
  try {
    archiveDb.exec(`
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
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL);
      CREATE TABLE banknote_tags (banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (banknote_id, tag_id));
    `);
    archiveDb.prepare(`INSERT INTO collections (id, name, is_default) VALUES (5, 'No Scrape Columns', 0)`).run();
    archiveDb.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (5, 5, 1, '50 Lei', '[]')`).run();
  } finally {
    archiveDb.close();
  }

  try {
    mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir);

    const db = new Database(path.join(stagedDataDir, 'banknotes.db'), { readonly: true });
    try {
      const note = db.prepare(`SELECT denomination, scrape_status, scrape_error FROM banknotes WHERE denomination = '50 Lei'`).get();
      assert.equal(note.denomination, '50 Lei');
      assert.equal(note.scrape_status, 'pending');
      assert.equal(note.scrape_error, null);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test('stripScrapeColumns drops the scrape columns and preserves the notes', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE banknotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        denomination TEXT,
        scrape_status TEXT DEFAULT 'pending',
        scrape_error TEXT
      );
      INSERT INTO banknotes (denomination, scrape_status, scrape_error) VALUES ('10 Lei', 'failed', 'boom');
    `);

    stripScrapeColumns(db);

    const columns = db.prepare(`PRAGMA table_info(banknotes)`).all().map((column) => column.name);
    assert.deepEqual(columns, ['id', 'denomination']);
    assert.equal(db.prepare(`SELECT denomination FROM banknotes`).get().denomination, '10 Lei');

    // Running again on a snapshot that already lacks the columns is a no-op.
    stripScrapeColumns(db);
    assert.equal(db.prepare(`SELECT COUNT(*) AS value FROM banknotes`).get().value, 1);
  } finally {
    db.close();
  }
});

// Ticket 15: Showcases travel in the archive. The three showcase tables are
// additive, so every helper builds them on demand and legacy fixtures simply
// omit them.

// The base archive tables, matching the shape `mergeArchiveIntoStagedData`
// reads and writes.
const baseArchiveSchemaSql = `
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
`;

// Mirrors `ensureShowcasesSchema` in db.js (ADR 0001).
function createShowcaseTables(db) {
  db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_categories_name_nocase ON categories(name COLLATE NOCASE);

    CREATE TABLE showcases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_order INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_showcases_name_nocase ON showcases(name COLLATE NOCASE);
    CREATE INDEX idx_showcases_display_order ON showcases(display_order, id);

    CREATE TABLE showcase_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      showcase_id INTEGER NOT NULL REFERENCES showcases(id) ON DELETE CASCADE,
      parent_node_id INTEGER REFERENCES showcase_nodes(id) ON DELETE CASCADE,
      node_type TEXT NOT NULL CHECK (node_type IN ('category','grouping','note')),
      category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
      name TEXT,
      note_id INTEGER REFERENCES banknotes(id) ON DELETE CASCADE,
      cover_note_id INTEGER REFERENCES banknotes(id) ON DELETE SET NULL,
      position INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX idx_showcase_nodes_category_once
      ON showcase_nodes(showcase_id, category_id) WHERE node_type = 'category';
    CREATE INDEX idx_showcase_nodes_parent ON showcase_nodes(parent_node_id, position, id);
  `);
}

function createShowcaseSnapshotDatabase() {
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
  createShowcaseTables(db);
  db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (10, 'A', 1), (25, 'B', 0)`).run();
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, '[]')`).run(
    100, 10, 5, '10 Lei'
  );
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, '[]')`).run(
    300, 10, 1, '20 Lei'
  );
  db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (?, ?, ?, ?, '[]')`).run(
    200, 25, 3, '5 Lei'
  );
  db.prepare(`INSERT INTO categories (id, name) VALUES (7, 'Shared')`).run();
  db.prepare(`INSERT INTO showcases (id, name, display_order) VALUES (42, 'One', 1), (43, 'Two', 2)`).run();
  db.prepare(`
    INSERT INTO showcase_nodes
      (id, showcase_id, parent_node_id, node_type, category_id, name, note_id, cover_note_id, position)
    VALUES
      (501, 42, NULL, 'category', 7, NULL, NULL, NULL, 1),
      (502, 42, 501, 'grouping', NULL, 'G', NULL, NULL, 1),
      (503, 42, 502, 'note', NULL, NULL, 300, NULL, 1),
      (504, 43, NULL, 'category', 7, NULL, NULL, NULL, 1),
      (505, 43, 504, 'grouping', NULL, 'CoverG', NULL, 200, 1),
      (506, 43, 505, 'note', NULL, NULL, 200, NULL, 1)
  `).run();
  db.pragma('foreign_keys = ON');
  return db;
}

test('renumberSnapshot remaps the three showcase tables and the self-referential parent', () => {
  const db = createShowcaseSnapshotDatabase();

  try {
    const { categoryMap, showcaseMap, nodeMap } = renumberSnapshot(db);

    assert.deepEqual([...categoryMap.entries()], [[7, 1]]);
    assert.deepEqual([...showcaseMap.entries()].sort((a, b) => a[0] - b[0]), [[42, 1], [43, 2]]);
    assert.deepEqual(
      [...nodeMap.entries()].sort((a, b) => a[0] - b[0]),
      [[501, 1], [502, 2], [503, 3], [504, 4], [505, 5], [506, 6]]
    );

    assert.deepEqual(db.prepare(`SELECT id FROM categories ORDER BY id`).all(), [{ id: 1 }]);
    assert.deepEqual(
      db.prepare(`SELECT id, display_order FROM showcases ORDER BY id`).all(),
      [{ id: 1, display_order: 1 }, { id: 2, display_order: 2 }]
    );

    // noteMap orders notes by collection then display_order: 300 -> 1, 100 -> 2, 200 -> 3.
    assert.deepEqual(
      db.prepare(`
        SELECT id, showcase_id, parent_node_id, node_type, category_id, name, note_id, cover_note_id
        FROM showcase_nodes ORDER BY id
      `).all(),
      [
        { id: 1, showcase_id: 1, parent_node_id: null, node_type: 'category', category_id: 1, name: null, note_id: null, cover_note_id: null },
        { id: 2, showcase_id: 1, parent_node_id: 1, node_type: 'grouping', category_id: null, name: 'G', note_id: null, cover_note_id: null },
        { id: 3, showcase_id: 1, parent_node_id: 2, node_type: 'note', category_id: null, name: null, note_id: 1, cover_note_id: null },
        { id: 4, showcase_id: 2, parent_node_id: null, node_type: 'category', category_id: 1, name: null, note_id: null, cover_note_id: null },
        { id: 5, showcase_id: 2, parent_node_id: 4, node_type: 'grouping', category_id: null, name: 'CoverG', note_id: null, cover_note_id: 3 },
        { id: 6, showcase_id: 2, parent_node_id: 5, node_type: 'note', category_id: null, name: null, note_id: 3, cover_note_id: null }
      ]
    );

    assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), []);
    assert.deepEqual(
      db.prepare(`SELECT name, seq FROM sqlite_sequence WHERE name IN ('categories', 'showcases', 'showcase_nodes') ORDER BY name`).all(),
      [
        { name: 'categories', seq: 1 },
        { name: 'showcase_nodes', seq: 6 },
        { name: 'showcases', seq: 2 }
      ]
    );
  } finally {
    db.close();
  }
});

function createShowcaseExportSnapshotFile(dbPath) {
  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE collections (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE banknotes (id INTEGER PRIMARY KEY AUTOINCREMENT, collection_id INTEGER, display_order INTEGER, denomination TEXT, images TEXT);
      CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, collection_id INTEGER NOT NULL);
      CREATE TABLE banknote_tags (banknote_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (banknote_id, tag_id));
    `);
    createShowcaseTables(db);
    db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (1, 'Keep', 1), (2, 'Drop', 0)`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (10, 1, 1, 'Kept Note', '[]'), (20, 2, 1, 'Dropped Note', '[]')`).run();
    db.prepare(`INSERT INTO categories (id, name) VALUES (1, 'Shared Label'), (2, 'Only Dropped Label'), (3, 'Cover Label')`).run();
    db.prepare(`INSERT INTO showcases (id, name, display_order) VALUES (1, 'Kept Show', 1), (2, 'Dropped Show', 2), (3, 'Cover Only Show', 3)`).run();
    db.prepare(`
      INSERT INTO showcase_nodes
        (id, showcase_id, parent_node_id, node_type, category_id, name, note_id, cover_note_id, position)
      VALUES
        (11, 1, NULL, 'category', 1, NULL, NULL, NULL, 1),
        (12, 1, 11, 'note', NULL, NULL, 10, NULL, 1),
        (21, 2, NULL, 'category', 1, NULL, NULL, NULL, 1),
        (22, 2, 21, 'note', NULL, NULL, 20, NULL, 1),
        (23, 2, NULL, 'category', 2, NULL, NULL, NULL, 2),
        (31, 3, NULL, 'category', 3, NULL, NULL, NULL, 1),
        (32, 3, 31, 'grouping', NULL, 'Cover Group', NULL, 20, 1)
    `).run();
    db.pragma('foreign_keys = ON');
  } finally {
    db.close();
  }
}

test('a filtered export omits an out-of-selection showcase, reports it, and drops its labels', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-filtered-export-'));
  const snapshotDbPath = path.join(tempRoot, 'banknotes.db');

  try {
    createShowcaseExportSnapshotFile(snapshotDbPath);

    const result = buildFilteredExportSnapshot(snapshotDbPath, [1], tempRoot);

    assert.deepEqual(result.omittedShowcases, [
      { id: 2, name: 'Dropped Show' },
      { id: 3, name: 'Cover Only Show' }
    ]);
    assert.equal(result.selectedCount, 1);

    const db = new Database(snapshotDbPath, { readonly: true });
    try {
      assert.deepEqual(db.prepare(`SELECT name FROM showcases ORDER BY id`).all().map((row) => row.name), ['Kept Show']);
      assert.deepEqual(db.prepare(`SELECT id FROM banknotes ORDER BY id`).all(), [{ id: 1 }]);
      // 'Shared Label' survives on the kept Showcase; the labels used only by
      // the omitted Showcases go with them.
      assert.deepEqual(
        db.prepare(`SELECT name FROM categories ORDER BY name`).all().map((row) => row.name),
        ['Shared Label']
      );
      assert.deepEqual(
        db.prepare(`
          SELECT id, showcase_id, parent_node_id, node_type, category_id, note_id
          FROM showcase_nodes ORDER BY id
        `).all(),
        [
          { id: 1, showcase_id: 1, parent_node_id: null, node_type: 'category', category_id: 1, note_id: null },
          { id: 2, showcase_id: 1, parent_node_id: 1, node_type: 'note', category_id: null, note_id: 1 }
        ]
      );
      assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), []);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function createShowcaseImportStagedDataDir() {
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-showcase-import-stage-'));
  const stagedDataDir = path.join(stageRoot, 'data');
  fs.mkdirSync(path.join(stagedDataDir, 'images'), { recursive: true });

  const db = new Database(path.join(stagedDataDir, 'banknotes.db'));
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(baseArchiveSchemaSql);
    createShowcaseTables(db);
    db.prepare(`INSERT INTO categories (id, name) VALUES (1, 'Existing Label')`).run();
    db.prepare(`INSERT INTO showcases (id, name, display_order) VALUES (1, 'Existing Showcase', 1)`).run();
    db.prepare(`
      INSERT INTO showcase_nodes (id, showcase_id, parent_node_id, node_type, category_id, name, position)
      VALUES (1, 1, NULL, 'category', 1, NULL, 1)
    `).run();
  } finally {
    db.close();
  }

  return { stageRoot, stagedDataDir };
}

function createShowcaseImportArchiveDataDir() {
  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-showcase-import-src-'));
  const archiveDataDir = path.join(archiveRoot, 'data');
  fs.mkdirSync(path.join(archiveDataDir, 'images', 'notes', '500'), { recursive: true });

  const db = new Database(path.join(archiveDataDir, 'banknotes.db'));
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(baseArchiveSchemaSql);
    createShowcaseTables(db);
    db.prepare(`INSERT INTO collections (id, name, is_default) VALUES (5, 'Archive Col', 0)`).run();
    db.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (500, 5, 1, 'Archive Note', '[]'), (501, 5, 2, 'Archive Cover', '[]')`).run();
    db.prepare(`INSERT INTO categories (id, name) VALUES (9, 'Existing Label'), (10, 'Fresh Label')`).run();
    db.prepare(`INSERT INTO showcases (id, name, display_order) VALUES (7, 'Existing Showcase', 1), (8, 'Fresh Showcase', 2)`).run();
    db.prepare(`
      INSERT INTO showcase_nodes
        (id, showcase_id, parent_node_id, node_type, category_id, name, note_id, cover_note_id, position)
      VALUES
        (70, 8, NULL, 'category', 9, NULL, NULL, NULL, 1),
        (71, 8, 70, 'grouping', NULL, 'Group', NULL, 501, 1),
        (72, 8, 71, 'note', NULL, NULL, 500, NULL, 1),
        (73, 8, NULL, 'category', 10, NULL, NULL, NULL, 2),
        (74, 7, NULL, 'category', 10, NULL, NULL, NULL, 1)
    `).run();
    db.pragma('foreign_keys = ON');
  } finally {
    db.close();
  }

  return { archiveRoot, archiveDataDir };
}

test('importing a showcase archive reuses labels by name, skips an existing showcase, and resolves nodes in two passes', () => {
  const { stageRoot, stagedDataDir } = createShowcaseImportStagedDataDir();
  const { archiveRoot, archiveDataDir } = createShowcaseImportArchiveDataDir();

  try {
    mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir);

    const db = new Database(path.join(stagedDataDir, 'banknotes.db'), { readonly: true });
    try {
      // The label is matched case-insensitively and reused, never duplicated.
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS value FROM categories WHERE lower(name) = lower('Existing Label')`).get().value,
        1
      );
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS value FROM categories WHERE lower(name) = lower('Fresh Label')`).get().value,
        1
      );

      // The pre-existing Showcase is skipped, so its lone node is untouched.
      const existingShowcase = db.prepare(`SELECT id FROM showcases WHERE name = 'Existing Showcase'`).get();
      assert.equal(
        db.prepare(`SELECT COUNT(*) AS value FROM showcase_nodes WHERE showcase_id = ?`).get(existingShowcase.id).value,
        1
      );

      const freshShowcase = db.prepare(`SELECT id FROM showcases WHERE name = 'Fresh Showcase'`).get();
      assert.ok(freshShowcase, 'expected the new showcase to be inserted');

      const stagedNote = db.prepare(`SELECT id FROM banknotes WHERE denomination = 'Archive Note'`).get();
      const stagedCover = db.prepare(`SELECT id FROM banknotes WHERE denomination = 'Archive Cover'`).get();
      const stagedExistingLabel = db.prepare(`SELECT id FROM categories WHERE name = 'Existing Label'`).get();
      const stagedFreshLabel = db.prepare(`SELECT id FROM categories WHERE name = 'Fresh Label'`).get();

      const nodes = db.prepare(`
        SELECT id, parent_node_id, node_type, category_id, name, note_id, cover_note_id
        FROM showcase_nodes
        WHERE showcase_id = ?
      `).all(freshShowcase.id);

      const categoryNodes = nodes.filter((node) => node.node_type === 'category');
      assert.deepEqual(
        categoryNodes.map((node) => node.category_id).sort(),
        [stagedExistingLabel.id, stagedFreshLabel.id].sort()
      );
      for (const node of categoryNodes) {
        assert.equal(node.parent_node_id, null);
      }

      // Two-pass resolution: the grouping's parent is the top-level category,
      // the note's parent is the grouping, and the note references resolve to
      // the freshly inserted staged ids.
      const grouping = nodes.find((node) => node.node_type === 'grouping');
      assert.equal(grouping.name, 'Group');
      assert.equal(grouping.cover_note_id, stagedCover.id);
      assert.equal(grouping.parent_node_id, categoryNodes.find((node) => node.category_id === stagedExistingLabel.id).id);

      const noteNode = nodes.find((node) => node.node_type === 'note');
      assert.equal(noteNode.note_id, stagedNote.id);
      assert.equal(noteNode.parent_node_id, grouping.id);

      assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), []);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});

test('importing an old archive with none of the showcase tables leaves the staged showcases untouched', () => {
  const { stageRoot, stagedDataDir } = createShowcaseImportStagedDataDir();
  const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-old-archive-src-'));
  const archiveDataDir = path.join(archiveRoot, 'data');
  fs.mkdirSync(path.join(archiveDataDir, 'images'), { recursive: true });

  const archiveDb = new Database(path.join(archiveDataDir, 'banknotes.db'));
  try {
    archiveDb.exec(baseArchiveSchemaSql);
    archiveDb.prepare(`INSERT INTO collections (id, name, is_default) VALUES (5, 'Old Archive', 0)`).run();
    archiveDb.prepare(`INSERT INTO banknotes (id, collection_id, display_order, denomination, images) VALUES (50, 5, 1, 'Old Note', '[]')`).run();
  } finally {
    archiveDb.close();
  }

  try {
    mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir);

    const db = new Database(path.join(stagedDataDir, 'banknotes.db'), { readonly: true });
    try {
      assert.equal(db.prepare(`SELECT COUNT(*) AS value FROM banknotes WHERE denomination = 'Old Note'`).get().value, 1);
      // The staged database keeps its pre-existing showcase and gains none.
      assert.deepEqual(db.prepare(`SELECT name FROM showcases ORDER BY id`).all().map((row) => row.name), ['Existing Showcase']);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  }
});
