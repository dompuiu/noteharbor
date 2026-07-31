import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import {
  normalizeImages,
  removeStaleManagedFiles
} from './imageStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../../..');
const DATA_DIR = path.resolve(process.env.NOTE_HARBOR_DATA_DIR || path.join(ROOT_DIR, 'data'));
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const NOTE_IMAGES_DIR = path.join(IMAGES_DIR, 'notes');
const DB_PATH = path.join(DATA_DIR, 'banknotes.db');
const DEFAULT_COLLECTION_NAME = 'Default';

const noteFields = `
  id,
  collection_id,
  display_order,
  denomination,
  issue_date,
  catalog_number,
  grading_company,
  grade,
  watermark,
  serial,
  url,
  notes,
  scraped_data,
  images,
  scrape_status,
  scrape_error,
  created_at,
  updated_at
`;

let db = null;
let statements = null;

function ensureDataDirs() {
  fs.mkdirSync(NOTE_IMAGES_DIR, { recursive: true });
}

function normalizeCollectionName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

function ensureCollectionsTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_name_nocase
      ON collections(name COLLATE NOCASE);
  `);

  const columns = database.prepare(`PRAGMA table_info(collections)`).all();

  if (!columns.some((column) => column.name === 'is_default')) {
    database.exec(`ALTER TABLE collections ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0`);
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_single_default
      ON collections(is_default)
      WHERE is_default = 1;
  `);
}

function ensureDefaultCollection(database) {
  const existingDefault = database.prepare(`
    SELECT id
    FROM collections
    WHERE is_default = 1
    ORDER BY id ASC
    LIMIT 1
  `).get();

  if (existingDefault) {
    return Number(existingDefault.id);
  }

  const firstExisting = database.prepare(`
    SELECT id
    FROM collections
    ORDER BY id ASC
    LIMIT 1
  `).get();

  if (firstExisting) {
    return Number(firstExisting.id);
  }

  const banknotesCount = Number(database.prepare(`SELECT COUNT(*) AS value FROM banknotes`).get()?.value ?? 0);
  const tagsCount = Number(database.prepare(`SELECT COUNT(*) AS value FROM tags`).get()?.value ?? 0);

  if (banknotesCount <= 0 && tagsCount <= 0) {
    return null;
  }

  const inserted = database.prepare(`
    INSERT INTO collections (name, is_default, created_at, updated_at)
    VALUES (?, 1, datetime('now'), datetime('now'))
  `).run(DEFAULT_COLLECTION_NAME);

  return Number(inserted.lastInsertRowid);
}

function ensureDefaultCollectionFlag(database, defaultCollectionId) {
  const hasDefault = database.prepare(`
    SELECT id
    FROM collections
    WHERE is_default = 1
    LIMIT 1
  `).get();

  if (hasDefault) {
    return;
  }

  if (!Number.isInteger(defaultCollectionId) || defaultCollectionId <= 0) {
    return;
  }

  database.prepare(`UPDATE collections SET is_default = 0`).run();
  database.prepare(`UPDATE collections SET is_default = 1 WHERE id = ?`).run(defaultCollectionId);
}

function migrateTagsForCollectionScope(database, defaultCollectionId) {
  const tagsTableDefinition = database.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'tags'
  `).get();

  const tagsColumns = database.prepare(`PRAGMA table_info(tags)`).all();
  const hasCollectionColumn = tagsColumns.some((column) => column.name === 'collection_id');

  if (!hasCollectionColumn) {
    database.exec(`ALTER TABLE tags ADD COLUMN collection_id INTEGER`);
    database.prepare(`UPDATE tags SET collection_id = ? WHERE collection_id IS NULL`).run(defaultCollectionId);
  }

  if (/name\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(tagsTableDefinition?.sql ?? '')) {
    database.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE tags_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE
      );

      INSERT INTO tags_new (id, name, collection_id)
      SELECT id, name, COALESCE(collection_id, ${defaultCollectionId})
      FROM tags;

      DROP TABLE tags;
      ALTER TABLE tags_new RENAME TO tags;

      PRAGMA foreign_keys = ON;
    `);
  }

  database.prepare(`UPDATE tags SET collection_id = ? WHERE collection_id IS NULL`).run(defaultCollectionId);

  const duplicateRows = database.prepare(`
    SELECT id, collection_id, lower(name) AS normalized_name
    FROM tags
    ORDER BY collection_id ASC, normalized_name ASC, id ASC
  `).all();

  const dedupeTags = database.transaction((rows) => {
    const canonicalByKey = new Map();

    for (const row of rows) {
      const key = `${row.collection_id}:${row.normalized_name}`;
      const canonicalId = canonicalByKey.get(key);

      if (!canonicalId) {
        canonicalByKey.set(key, row.id);
        continue;
      }

      database.prepare(`
        INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id)
        SELECT banknote_id, ?
        FROM banknote_tags
        WHERE tag_id = ?
      `).run(canonicalId, row.id);

      database.prepare(`DELETE FROM banknote_tags WHERE tag_id = ?`).run(row.id);
      database.prepare(`DELETE FROM tags WHERE id = ?`).run(row.id);
    }
  });

  dedupeTags(duplicateRows);

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_collection_name_nocase
      ON tags(collection_id, name COLLATE NOCASE);
  `);
}

function migrateBanknotesForCollectionScope(database, defaultCollectionId) {
  const banknotesColumns = database.prepare(`PRAGMA table_info(banknotes)`).all();

  if (!banknotesColumns.some((column) => column.name === 'collection_id')) {
    database.exec(`ALTER TABLE banknotes ADD COLUMN collection_id INTEGER`);
  }

  if (Number.isInteger(defaultCollectionId) && defaultCollectionId > 0) {
    database.prepare(`UPDATE banknotes SET collection_id = ? WHERE collection_id IS NULL`).run(defaultCollectionId);
  }
}

function initializeSchema(database) {
  database.pragma('foreign_keys = ON');

  ensureCollectionsTable(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS banknotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
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

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS banknote_tags (
      banknote_id INTEGER NOT NULL REFERENCES banknotes(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (banknote_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS slideshow_sessions (
      token TEXT PRIMARY KEY,
      ids TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const defaultCollectionId = ensureDefaultCollection(database);
  ensureDefaultCollectionFlag(database, defaultCollectionId);

  const banknotesTableDefinition = database.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'banknotes'
  `).get();

  if (/UNIQUE\s*\(\s*catalog_number\s*,\s*serial\s*\)/i.test(banknotesTableDefinition?.sql ?? '')) {
    database.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE banknotes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
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

      INSERT INTO banknotes_new (
        id,
        collection_id,
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes,
        scraped_data,
        images,
        scrape_status,
        scrape_error,
        created_at,
        updated_at
      )
      SELECT
        id,
        ${defaultCollectionId},
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes,
        scraped_data,
        images,
        scrape_status,
        scrape_error,
        created_at,
        updated_at
      FROM banknotes;

      DROP TABLE banknotes;
      ALTER TABLE banknotes_new RENAME TO banknotes;

      PRAGMA foreign_keys = ON;
    `);
  }

  migrateBanknotesForCollectionScope(database, defaultCollectionId);
  migrateTagsForCollectionScope(database, defaultCollectionId);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_banknotes_collection_display_order
      ON banknotes(collection_id, display_order, id);

    CREATE INDEX IF NOT EXISTS idx_banknotes_collection_id
      ON banknotes(collection_id);

    CREATE INDEX IF NOT EXISTS idx_tags_collection_id
      ON tags(collection_id);
  `);

  const banknoteColumns = database.prepare(`PRAGMA table_info(banknotes)`).all();

  if (!banknoteColumns.some((column) => column.name === 'display_order')) {
    database.exec(`ALTER TABLE banknotes ADD COLUMN display_order INTEGER`);
  }

  const assignMissingDisplayOrderStatement = database.prepare(`
    UPDATE banknotes
    SET display_order = @display_order
    WHERE id = @id
  `);

  const collections = database.prepare(`SELECT id FROM collections ORDER BY id ASC`).all();

  const backfillDisplayOrder = database.transaction((collectionRows) => {
    for (const collection of collectionRows) {
      const missingRows = database.prepare(`
        SELECT id
        FROM banknotes
        WHERE collection_id = ?
          AND display_order IS NULL
        ORDER BY id ASC
      `).all(collection.id);

      if (!missingRows.length) {
        continue;
      }

      const maxDisplayOrderRow = database
        .prepare(`SELECT COALESCE(MAX(display_order), 0) AS value FROM banknotes WHERE collection_id = ?`)
        .get(collection.id);
      let nextDisplayOrder = Number(maxDisplayOrderRow?.value ?? 0) + 1;

      for (const row of missingRows) {
        assignMissingDisplayOrderStatement.run({
          id: row.id,
          display_order: nextDisplayOrder
        });
        nextDisplayOrder += 1;
      }
    }
  });

  backfillDisplayOrder(collections);
}

function createStatements(database) {
  return {
    listCollectionsStatement: database.prepare(`
      SELECT id, name, is_default, created_at, updated_at
      FROM collections
      ORDER BY is_default DESC, name COLLATE NOCASE ASC, id ASC
    `),
    getDefaultCollectionStatement: database.prepare(`
      SELECT id, name, is_default, created_at, updated_at
      FROM collections
      WHERE is_default = 1
      ORDER BY id ASC
      LIMIT 1
    `),
    getCollectionStatement: database.prepare(`
      SELECT id, name, is_default, created_at, updated_at
      FROM collections
      WHERE id = ?
    `),
    createCollectionStatement: database.prepare(`
      INSERT INTO collections (name, is_default, created_at, updated_at)
      VALUES (@name, 0, datetime('now'), datetime('now'))
    `),
    renameCollectionStatement: database.prepare(`
      UPDATE collections
      SET name = @name,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    clearDefaultCollectionStatement: database.prepare(`
      UPDATE collections
      SET is_default = 0,
          updated_at = datetime('now')
      WHERE is_default = 1
    `),
    markDefaultCollectionStatement: database.prepare(`
      UPDATE collections
      SET is_default = 1,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    deleteCollectionStatement: database.prepare(`DELETE FROM collections WHERE id = ?`),
    countCollectionsStatement: database.prepare(`SELECT COUNT(*) AS value FROM collections`),

    listNotesStatement: database.prepare(`
      SELECT ${noteFields}
      FROM banknotes
      WHERE collection_id = @collection_id
      ORDER BY display_order ASC, id ASC
    `),
    getNoteByIdStatement: database.prepare(`SELECT ${noteFields} FROM banknotes WHERE id = ?`),
    getNoteByIdAndCollectionStatement: database.prepare(`
      SELECT ${noteFields}
      FROM banknotes
      WHERE id = @id AND collection_id = @collection_id
    `),
    listNoteIdsByCollectionStatement: database.prepare(`
      SELECT id
      FROM banknotes
      WHERE collection_id = ?
      ORDER BY id ASC
    `),
    deleteNotesByCollectionStatement: database.prepare(`DELETE FROM banknotes WHERE collection_id = ?`),
    deleteTagsByCollectionStatement: database.prepare(`DELETE FROM tags WHERE collection_id = ?`),
    deleteOrphanTagLinksStatement: database.prepare(`
      DELETE FROM banknote_tags
      WHERE tag_id NOT IN (SELECT id FROM tags)
         OR banknote_id NOT IN (SELECT id FROM banknotes)
    `),

    listTagsForCollectionStatement: database.prepare(`
      SELECT DISTINCT t.id, t.name
      FROM tags t
      INNER JOIN banknote_tags bt ON bt.tag_id = t.id
      INNER JOIN banknotes b ON b.id = bt.banknote_id
      WHERE t.collection_id = @collection_id
        AND b.collection_id = @collection_id
      ORDER BY t.name COLLATE NOCASE ASC
    `),
    listTagsForNotesByCollectionStatement: database.prepare(`
      SELECT bt.banknote_id, t.id, t.name
      FROM banknote_tags bt
      INNER JOIN tags t ON t.id = bt.tag_id
      INNER JOIN banknotes b ON b.id = bt.banknote_id
      WHERE b.collection_id = @collection_id
      ORDER BY t.name COLLATE NOCASE ASC
    `),
    listTagsForAllNotesStatement: database.prepare(`
      SELECT bt.banknote_id, t.id, t.name
      FROM banknote_tags bt
      INNER JOIN tags t ON t.id = bt.tag_id
      ORDER BY t.name COLLATE NOCASE ASC
    `),
    insertTagStatement: database.prepare(`INSERT OR IGNORE INTO tags (name, collection_id) VALUES (@name, @collection_id)`),
    getTagByNameStatement: database.prepare(`SELECT id, name FROM tags WHERE collection_id = @collection_id AND lower(name) = lower(@name)`),
    clearNoteTagsStatement: database.prepare(`DELETE FROM banknote_tags WHERE banknote_id = ?`),
    insertNoteTagStatement: database.prepare(`INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?, ?)`),

    upsertBanknoteStatement: database.prepare(`
      INSERT INTO banknotes (
        collection_id,
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes,
        updated_at
      )
      VALUES (@collection_id, @display_order, @denomination, @issue_date, @catalog_number, @grading_company, @grade, @watermark, @serial, @url, @notes, datetime('now'))
    `),
    insertNoteStatement: database.prepare(`
      INSERT INTO banknotes (
        collection_id,
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes,
        scraped_data,
        images,
        created_at,
        updated_at
      )
      VALUES (
        @collection_id,
        @display_order,
        @denomination,
        @issue_date,
        @catalog_number,
        @grading_company,
        @grade,
        @watermark,
        @serial,
        @url,
        @notes,
        @scraped_data,
        @images,
        datetime('now'),
        datetime('now')
      )
    `),
    updateNoteStatement: database.prepare(`
      UPDATE banknotes
      SET denomination = @denomination,
          issue_date = @issue_date,
          catalog_number = @catalog_number,
          grading_company = @grading_company,
          grade = @grade,
          watermark = @watermark,
          serial = @serial,
          url = @url,
          notes = @notes,
          scraped_data = @scraped_data,
          images = @images,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    updateScrapeStatement: database.prepare(`
      UPDATE banknotes
      SET scraped_data = @scraped_data,
          images = @images,
          scrape_status = @scrape_status,
          scrape_error = @scrape_error,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    deleteNoteStatement: database.prepare(`DELETE FROM banknotes WHERE id = ?`),
    compactDisplayOrderAfterDeleteStatement: database.prepare(`
      UPDATE banknotes
      SET display_order = display_order - 1,
          updated_at = datetime('now')
      WHERE collection_id = @collection_id
        AND display_order > @display_order
    `),
    maxDisplayOrderStatement: database.prepare(`
      SELECT COALESCE(MAX(display_order), 0) AS value
      FROM banknotes
      WHERE collection_id = ?
    `),
    updateDisplayOrderStatement: database.prepare(`
      UPDATE banknotes
      SET display_order = @display_order,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    moveNoteCollectionStatement: database.prepare(`
      UPDATE banknotes
      SET collection_id = @collection_id,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    listImportRowsStatement: database.prepare(`
      SELECT
        id,
        collection_id,
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes
      FROM banknotes
      WHERE collection_id = @collection_id
      ORDER BY display_order ASC, id ASC
    `),
    updateImportedNoteStatement: database.prepare(`
      UPDATE banknotes
      SET denomination = @denomination,
          issue_date = @issue_date,
          catalog_number = @catalog_number,
          grading_company = @grading_company,
          grade = @grade,
          watermark = @watermark,
          serial = @serial,
          url = @url,
          notes = @notes,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    insertSlideshowSessionStatement: database.prepare(`
      INSERT INTO slideshow_sessions (token, ids, created_at)
      VALUES (@token, @ids, datetime('now'))
    `),
    getSlideshowSessionStatement: database.prepare(`SELECT token, ids, created_at FROM slideshow_sessions WHERE token = ?`),
    deleteExpiredSlideshowSessionsStatement: database.prepare(`
      DELETE FROM slideshow_sessions
      WHERE created_at < datetime('now', '-1 day')
    `)
  };
}

function openDatabase() {
  if (db) {
    return db;
  }

  ensureDataDirs();
  db = new Database(DB_PATH);
  initializeSchema(db);
  statements = createStatements(db);
  return db;
}

function getDatabase() {
  return openDatabase();
}

function closeDatabase() {
  if (!db) {
    return;
  }

  db.close();
  db = null;
  statements = null;
}

function reloadDatabase() {
  closeDatabase();
  return openDatabase();
}

function verifyDatabaseFile(filePath) {
  const tempDatabase = new Database(filePath, { readonly: true, fileMustExist: true });

  try {
    tempDatabase.pragma('foreign_keys = ON');
    const tables = tempDatabase.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name IN ('banknotes', 'tags', 'banknote_tags')
    `).all();
    const tableNames = new Set(tables.map((row) => row.name));

    if (!tableNames.has('banknotes') || !tableNames.has('tags') || !tableNames.has('banknote_tags')) {
      throw new Error('Archive database is missing required tables.');
    }

    tempDatabase.prepare('SELECT COUNT(*) AS value FROM banknotes').get();
  } finally {
    tempDatabase.close();
  }
}

async function backupDatabase(destinationPath) {
  const activeDatabase = getDatabase();
  await activeDatabase.backup(destinationPath);
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeTagName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeImportValue(value) {
  return String(value ?? '').trim().toLowerCase();
}

function buildImportIdentity(note) {
  const url = normalizeImportValue(note.url);
  if (url) {
    return `url:${url}`;
  }

  const company = normalizeImportValue(note.grading_company);
  const catalogNumber = normalizeImportValue(note.catalog_number);
  const serial = normalizeImportValue(note.serial);

  if (company && (catalogNumber || serial)) {
    return `company:${company}|catalog:${catalogNumber}|serial:${serial}`;
  }

  return [
    normalizeImportValue(note.denomination),
    normalizeImportValue(note.issue_date),
    catalogNumber,
    company,
    normalizeImportValue(note.watermark),
    serial
  ].join('|');
}

function rowToNote(row, tagMap) {
  return {
    ...row,
    scraped_data: parseJson(row.scraped_data, null),
    images: normalizeImages(parseJson(row.images, [])),
    tags: tagMap.get(row.id) ?? []
  };
}

function getDefaultCollectionId() {
  getDatabase();
  const preferred = statements.getDefaultCollectionStatement.get();

  if (preferred) {
    return Number(preferred.id);
  }

  const first = statements.listCollectionsStatement.get();

  if (first) {
    return Number(first.id);
  }

  return null;
}

function resolveCollectionId(collectionId) {
  if (collectionId == null) {
    const defaultCollectionId = getDefaultCollectionId();

    if (!Number.isInteger(defaultCollectionId) || defaultCollectionId <= 0) {
      throw new Error('No collections available.');
    }

    return defaultCollectionId;
  }

  const normalized = Number(collectionId);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error('A valid collection ID is required.');
  }

  return normalized;
}

function ensureCollectionExists(collectionId) {
  getDatabase();
  const collection = statements.getCollectionStatement.get(collectionId);

  if (!collection) {
    throw new Error('Collection not found.');
  }

  return collection;
}

function buildTagMap(collectionId = null) {
  const tagMap = new Map();
  const rows = collectionId == null
    ? statements.listTagsForAllNotesStatement.all()
    : statements.listTagsForNotesByCollectionStatement.all({ collection_id: collectionId });

  for (const row of rows) {
    if (!tagMap.has(row.banknote_id)) {
      tagMap.set(row.banknote_id, []);
    }

    tagMap.get(row.banknote_id).push({ id: row.id, name: row.name });
  }

  return tagMap;
}

function getAllCollections() {
  getDatabase();
  return statements.listCollectionsStatement.all();
}

function getCollectionById(id) {
  getDatabase();
  return statements.getCollectionStatement.get(Number(id)) ?? null;
}

function createCollection(name) {
  getDatabase();
  const normalizedName = normalizeCollectionName(name);

  if (!normalizedName) {
    throw new Error('Collection name is required.');
  }

  let collectionId;

  try {
    const result = statements.createCollectionStatement.run({ name: normalizedName });
    collectionId = Number(result.lastInsertRowid);
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed: collections.name')) {
      throw new Error('A collection with this name already exists.');
    }

    throw error;
  }

  return getCollectionById(collectionId);
}

function renameCollectionById(id, name) {
  getDatabase();
  const collectionId = Number(id);
  const normalizedName = normalizeCollectionName(name);

  if (!normalizedName) {
    throw new Error('Collection name is required.');
  }

  ensureCollectionExists(collectionId);

  try {
    statements.renameCollectionStatement.run({ id: collectionId, name: normalizedName });
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed: collections.name')) {
      throw new Error('A collection with this name already exists.');
    }

    throw error;
  }

  return getCollectionById(collectionId);
}

function removeManagedNoteImages(noteId) {
  const noteImagesDir = path.join(NOTE_IMAGES_DIR, String(noteId));

  if (!fs.existsSync(noteImagesDir)) {
    return;
  }

  fs.rmSync(noteImagesDir, { recursive: true, force: true });
}

function setDefaultCollectionById(id) {
  getDatabase();
  const collectionId = Number(id);
  ensureCollectionExists(collectionId);

  const transaction = db.transaction((targetCollectionId) => {
    statements.clearDefaultCollectionStatement.run();
    statements.markDefaultCollectionStatement.run({ id: targetCollectionId });
  });

  transaction(collectionId);
  return getCollectionById(collectionId);
}

function deleteCollectionById(id) {
  getDatabase();
  const collectionId = Number(id);
  const collection = ensureCollectionExists(collectionId);

  const fallbackCollection = statements.listCollectionsStatement
    .all()
    .find((entry) => Number(entry.id) !== collectionId);

  const noteIds = statements.listNoteIdsByCollectionStatement.all(collectionId).map((row) => Number(row.id));

  const transaction = db.transaction((targetCollectionId, nextDefaultId, isDeletingDefault) => {
    statements.deleteNotesByCollectionStatement.run(targetCollectionId);
    statements.deleteTagsByCollectionStatement.run(targetCollectionId);
    statements.deleteOrphanTagLinksStatement.run();
    statements.deleteCollectionStatement.run(targetCollectionId);

    if (isDeletingDefault && Number.isInteger(nextDefaultId) && nextDefaultId > 0) {
      statements.clearDefaultCollectionStatement.run();
      statements.markDefaultCollectionStatement.run({ id: nextDefaultId });
    }
  });

  transaction(
    collectionId,
    Number(fallbackCollection?.id ?? 0),
    Number(collection.is_default) === 1,
  );

  for (const noteId of noteIds) {
    removeManagedNoteImages(noteId);
  }
}

function getAllNotes(collectionId = null) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);

  const tagMap = buildTagMap(normalizedCollectionId);
  return statements.listNotesStatement.all({ collection_id: normalizedCollectionId }).map((row) => rowToNote(row, tagMap));
}

function getNoteById(id, collectionId = null) {
  getDatabase();
  const noteId = Number(id);

  if (collectionId == null) {
    const row = statements.getNoteByIdStatement.get(noteId);
    if (!row) {
      return null;
    }

    return rowToNote(row, buildTagMap());
  }

  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);

  const row = statements.getNoteByIdAndCollectionStatement.get({
    id: noteId,
    collection_id: normalizedCollectionId
  });

  if (!row) {
    return null;
  }

  return rowToNote(row, buildTagMap(normalizedCollectionId));
}

function getNotesByIds(ids) {
  getDatabase();

  if (!ids.length) {
    return [];
  }

  const placeholders = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
  const statement = db.prepare(`SELECT ${noteFields} FROM banknotes WHERE id IN (${ids.map((_, index) => `@id${index}`).join(', ')})`);
  const tagMap = buildTagMap();
  return statement.all(placeholders).map((row) => rowToNote(row, tagMap));
}

function getAllTags(collectionId = null) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);
  return statements.listTagsForCollectionStatement.all({ collection_id: normalizedCollectionId });
}

function ensureTag(collectionId, name) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);

  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    return null;
  }

  statements.insertTagStatement.run({
    name: normalizedName,
    collection_id: normalizedCollectionId
  });

  return statements.getTagByNameStatement.get({
    collection_id: normalizedCollectionId,
    name: normalizedName
  });
}

function replaceNoteTags(noteId, tagNames, collectionId = null) {
  getDatabase();
  const existing = getNoteById(noteId);

  if (!existing) {
    throw new Error('Note not found.');
  }

  const normalizedCollectionId = resolveCollectionId(collectionId ?? existing.collection_id);
  const normalizedNames = [...new Set((tagNames ?? []).map(normalizeTagName).filter(Boolean))];

  const transaction = db.transaction(() => {
    statements.clearNoteTagsStatement.run(noteId);

    for (const tagName of normalizedNames) {
      const tag = ensureTag(normalizedCollectionId, tagName);
      if (tag) {
        statements.insertNoteTagStatement.run(noteId, tag.id);
      }
    }
  });

  transaction();
}

function importNotes(notes, collectionId = null) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);

  const transaction = db.transaction((rows) => {
    const existingRows = statements.listImportRowsStatement.all({ collection_id: normalizedCollectionId });
    const matchedIds = new Set();
    const identityToRow = new Map();
    let importedCount = 0;
    let updatedCount = 0;
    const deletedIds = [];
    let nextDisplayOrder = 1;

    for (const row of existingRows) {
      identityToRow.set(buildImportIdentity(row), row);
    }

    for (const note of rows) {
      const identity = buildImportIdentity(note);
      const existing = identityToRow.get(identity);

      if (existing) {
        statements.updateImportedNoteStatement.run({
          ...note,
          id: existing.id
        });
        statements.updateDisplayOrderStatement.run({
          id: existing.id,
          display_order: nextDisplayOrder
        });
        replaceNoteTags(existing.id, note.tags, normalizedCollectionId);
        matchedIds.add(existing.id);
        identityToRow.set(identity, {
          ...existing,
          ...note,
          id: existing.id,
          collection_id: normalizedCollectionId,
          display_order: nextDisplayOrder
        });
        updatedCount += 1;
      } else {
        const result = statements.upsertBanknoteStatement.run({
          ...note,
          collection_id: normalizedCollectionId,
          display_order: nextDisplayOrder
        });
        const noteId = Number(result.lastInsertRowid);
        replaceNoteTags(noteId, note.tags, normalizedCollectionId);

        identityToRow.set(identity, {
          id: noteId,
          ...note,
          collection_id: normalizedCollectionId,
          display_order: nextDisplayOrder
        });
        importedCount += 1;
      }

      nextDisplayOrder += 1;
    }

    for (const row of existingRows) {
      if (matchedIds.has(row.id)) {
        continue;
      }

      statements.deleteNoteStatement.run(row.id);
      deletedIds.push(row.id);
    }

    return {
      imported: importedCount,
      updated: updatedCount,
      deleted: deletedIds.length,
      deletedIds
    };
  });

  const result = transaction(notes);

  for (const noteId of result.deletedIds) {
    removeManagedNoteImages(noteId);
  }

  return {
    imported: result.imported,
    updated: result.updated,
    deleted: result.deleted
  };
}

function getNextDisplayOrder(collectionId = null) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);
  const row = statements.maxDisplayOrderStatement.get(normalizedCollectionId);
  return Number(row?.value ?? 0) + 1;
}

function updateNote(note) {
  getDatabase();
  const existing = getNoteById(note.id);

  if (!existing) {
    throw new Error('Note not found.');
  }

  const collectionId = resolveCollectionId(note.collection_id ?? existing.collection_id);
  const normalizedImages = normalizeImages(note.images ?? []);

  const transaction = db.transaction((payload) => {
    statements.updateNoteStatement.run({
      ...payload,
      scraped_data: payload.scraped_data ? JSON.stringify(payload.scraped_data) : null,
      images: JSON.stringify(normalizedImages)
    });
    replaceNoteTags(payload.id, payload.tags, collectionId);
  });

  transaction(note);
  removeStaleManagedFiles(IMAGES_DIR, note.id, normalizedImages);
  return getNoteById(note.id, collectionId);
}

function createNote(note) {
  getDatabase();
  const collectionId = resolveCollectionId(note.collection_id);
  ensureCollectionExists(collectionId);

  const normalizedImages = normalizeImages(note.images ?? []);

  const transaction = db.transaction((payload) => {
    const result = statements.insertNoteStatement.run({
      ...payload,
      collection_id: collectionId,
      scraped_data: payload.scraped_data ? JSON.stringify(payload.scraped_data) : null,
      images: JSON.stringify(normalizedImages),
      display_order: getNextDisplayOrder(collectionId)
    });
    const noteId = Number(result.lastInsertRowid);
    replaceNoteTags(noteId, payload.tags, collectionId);
    return noteId;
  });

  const noteId = transaction(note);
  return getNoteById(noteId, collectionId);
}

function updateScrapeResult({ id, scrapedData, images, scrapeStatus, scrapeError }) {
  getDatabase();
  const normalizedImages = normalizeImages(images ?? []);

  statements.updateScrapeStatement.run({
    id,
    scraped_data: scrapedData ? JSON.stringify(scrapedData) : null,
    images: JSON.stringify(normalizedImages),
    scrape_status: scrapeStatus,
    scrape_error: scrapeError ?? null
  });

  removeStaleManagedFiles(IMAGES_DIR, id, normalizedImages);

  return getNoteById(id);
}

function deleteNote(id, collectionId = null) {
  getDatabase();
  const existing = getNoteById(id, collectionId);

  if (!existing) {
    return;
  }

  const transaction = db.transaction((noteId, targetCollectionId, displayOrder) => {
    statements.deleteNoteStatement.run(noteId);
    statements.compactDisplayOrderAfterDeleteStatement.run({
      collection_id: targetCollectionId,
      display_order: displayOrder
    });
  });

  transaction(existing.id, existing.collection_id, existing.display_order);
  removeManagedNoteImages(existing.id);
}

function reorderNotes(ids, collectionId = null) {
  getDatabase();
  const normalizedCollectionId = resolveCollectionId(collectionId);
  ensureCollectionExists(normalizedCollectionId);

  const normalizedIds = ids.map((id) => Number(id));
  const allNotes = getAllNotes(normalizedCollectionId);
  const existingIds = allNotes.map((note) => note.id);

  if (!normalizedIds.length || normalizedIds.length !== existingIds.length) {
    throw new Error('Reorder request must include every note exactly once.');
  }

  const nextIdsSet = new Set(normalizedIds);

  if (
    nextIdsSet.size !== normalizedIds.length ||
    existingIds.some((id) => !nextIdsSet.has(id))
  ) {
    throw new Error('Reorder request must include every note exactly once.');
  }

  const transaction = db.transaction((nextIds) => {
    nextIds.forEach((id, index) => {
      statements.updateDisplayOrderStatement.run({
        id,
        display_order: index + 1
      });
    });
  });

  transaction(normalizedIds);
  return getAllNotes(normalizedCollectionId);
}

function moveNoteToCollection(noteId, sourceCollectionId, targetCollectionId, position = {}) {
  getDatabase();

  const normalizedSourceId = resolveCollectionId(sourceCollectionId);
  const normalizedTargetId = resolveCollectionId(targetCollectionId);
  ensureCollectionExists(normalizedTargetId);

  if (normalizedSourceId === normalizedTargetId) {
    throw new Error('Note is already in this collection.');
  }

  const existing = getNoteById(noteId, normalizedSourceId);

  if (!existing) {
    throw new Error('Note not found.');
  }

  const { mode = 'end', referenceId = null } = position;
  const tagNames = (existing.tags ?? []).map((tag) => tag.name);
  const targetIds = getAllNotes(normalizedTargetId).map((note) => note.id);

  let nextOrder;

  if (mode === 'start') {
    nextOrder = [noteId, ...targetIds];
  } else if (mode === 'before' || mode === 'after') {
    const refIndex = targetIds.indexOf(Number(referenceId));

    if (refIndex === -1) {
      nextOrder = [...targetIds, noteId];
    } else {
      const insertAt = mode === 'before' ? refIndex : refIndex + 1;
      nextOrder = [...targetIds.slice(0, insertAt), noteId, ...targetIds.slice(insertAt)];
    }
  } else {
    nextOrder = [...targetIds, noteId];
  }

  const transaction = db.transaction(() => {
    statements.moveNoteCollectionStatement.run({
      id: noteId,
      collection_id: normalizedTargetId
    });

    nextOrder.forEach((id, index) => {
      statements.updateDisplayOrderStatement.run({
        id,
        display_order: index + 1
      });
    });

    replaceNoteTags(noteId, tagNames, normalizedTargetId);

    statements.compactDisplayOrderAfterDeleteStatement.run({
      collection_id: normalizedSourceId,
      display_order: existing.display_order
    });
  });

  transaction();

  return getNoteById(noteId, normalizedTargetId);
}

function createSlideshowSession(ids) {
  getDatabase();
  const normalizedIds = [...new Set((ids ?? []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];

  if (!normalizedIds.length) {
    throw new Error('A slideshow session requires at least one valid note ID.');
  }

  statements.deleteExpiredSlideshowSessionsStatement.run();

  const token = crypto.randomUUID();
  statements.insertSlideshowSessionStatement.run({
    token,
    ids: JSON.stringify(normalizedIds)
  });

  return { token, ids: normalizedIds };
}

function getSlideshowSession(token) {
  getDatabase();
  const normalizedToken = String(token ?? '').trim();

  if (!normalizedToken) {
    return null;
  }

  statements.deleteExpiredSlideshowSessionsStatement.run();

  const row = statements.getSlideshowSessionStatement.get(normalizedToken);

  if (!row) {
    return null;
  }

  return {
    token: row.token,
    ids: parseJson(row.ids, []),
    created_at: row.created_at
  };
}

openDatabase();

export {
  DATA_DIR,
  DB_PATH,
  IMAGES_DIR,
  ROOT_DIR,
  backupDatabase,
  closeDatabase,
  createCollection,
  createNote,
  createSlideshowSession,
  deleteCollectionById,
  deleteNote,
  ensureTag,
  getAllCollections,
  getAllNotes,
  getAllTags,
  getCollectionById,
  getDatabase,
  getDefaultCollectionId,
  getNoteById,
  getNotesByIds,
  getSlideshowSession,
  importNotes,
  moveNoteToCollection,
  openDatabase,
  reloadDatabase,
  renameCollectionById,
  reorderNotes,
  setDefaultCollectionById,
  replaceNoteTags,
  updateNote,
  updateScrapeResult,
  verifyDatabaseFile
};
