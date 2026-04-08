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

const noteFields = `
  id,
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

function initializeSchema(database) {
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS banknotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      name TEXT NOT NULL UNIQUE
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

  const banknoteColumns = database.prepare(`PRAGMA table_info(banknotes)`).all();

  if (!banknoteColumns.some((column) => column.name === 'display_order')) {
    database.exec(`ALTER TABLE banknotes ADD COLUMN display_order INTEGER`);
  }

  const assignMissingDisplayOrderStatement = database.prepare(`
    UPDATE banknotes
    SET display_order = @display_order
    WHERE id = @id
  `);

  const missingDisplayOrderRows = database.prepare(`
    SELECT id
    FROM banknotes
    WHERE display_order IS NULL
    ORDER BY id ASC
  `).all();

  if (missingDisplayOrderRows.length) {
    const maxDisplayOrderRow = database
      .prepare(`SELECT COALESCE(MAX(display_order), 0) AS value FROM banknotes`)
      .get();
    let nextDisplayOrder = Number(maxDisplayOrderRow?.value ?? 0) + 1;

    const backfillDisplayOrder = database.transaction((rows) => {
      for (const row of rows) {
        assignMissingDisplayOrderStatement.run({
          id: row.id,
          display_order: nextDisplayOrder
        });
        nextDisplayOrder += 1;
      }
    });

    backfillDisplayOrder(missingDisplayOrderRows);
  }
}

function createStatements(database) {
  return {
    listNotesStatement: database.prepare(`SELECT ${noteFields} FROM banknotes ORDER BY display_order ASC, id ASC`),
    getNoteStatement: database.prepare(`SELECT ${noteFields} FROM banknotes WHERE id = ?`),
    listTagsForNotesStatement: database.prepare(`
      SELECT bt.banknote_id, t.id, t.name
      FROM banknote_tags bt
      INNER JOIN tags t ON t.id = bt.tag_id
      ORDER BY t.name COLLATE NOCASE ASC
    `),
    listAllTagsStatement: database.prepare(`
      SELECT DISTINCT t.id, t.name
      FROM tags t
      INNER JOIN banknote_tags bt ON bt.tag_id = t.id
      ORDER BY t.name COLLATE NOCASE ASC
    `),
    insertTagStatement: database.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`),
    getTagByNameStatement: database.prepare(`SELECT id, name FROM tags WHERE name = ?`),
    clearNoteTagsStatement: database.prepare(`DELETE FROM banknote_tags WHERE banknote_id = ?`),
    insertNoteTagStatement: database.prepare(`INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?, ?)`),
    upsertBanknoteStatement: database.prepare(`
      INSERT INTO banknotes (
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
      VALUES (@display_order, @denomination, @issue_date, @catalog_number, @grading_company, @grade, @watermark, @serial, @url, @notes, datetime('now'))
    `),
    insertNoteStatement: database.prepare(`
      INSERT INTO banknotes (
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
      WHERE display_order > ?
    `),
    maxDisplayOrderStatement: database.prepare(`SELECT COALESCE(MAX(display_order), 0) AS value FROM banknotes`),
    updateDisplayOrderStatement: database.prepare(`
      UPDATE banknotes
      SET display_order = @display_order,
          updated_at = datetime('now')
      WHERE id = @id
    `),
    listImportRowsStatement: database.prepare(`
      SELECT
        id,
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

function buildTagMap() {
  const tagMap = new Map();

  for (const row of statements.listTagsForNotesStatement.all()) {
    if (!tagMap.has(row.banknote_id)) {
      tagMap.set(row.banknote_id, []);
    }

    tagMap.get(row.banknote_id).push({ id: row.id, name: row.name });
  }

  return tagMap;
}

function getAllNotes() {
  getDatabase();
  const tagMap = buildTagMap();
  return statements.listNotesStatement.all().map((row) => rowToNote(row, tagMap));
}

function getNoteById(id) {
  getDatabase();
  const row = statements.getNoteStatement.get(id);

  if (!row) {
    return null;
  }

  return rowToNote(row, buildTagMap());
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

function getAllTags() {
  getDatabase();
  return statements.listAllTagsStatement.all();
}

function ensureTag(name) {
  getDatabase();
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    return null;
  }

  statements.insertTagStatement.run(normalizedName);
  return statements.getTagByNameStatement.get(normalizedName);
}

function removeManagedNoteImages(noteId) {
  const noteImagesDir = path.join(NOTE_IMAGES_DIR, String(noteId));

  if (!fs.existsSync(noteImagesDir)) {
    return;
  }

  fs.rmSync(noteImagesDir, { recursive: true, force: true });
}

function replaceNoteTags(noteId, tagNames) {
  getDatabase();
  const normalizedNames = [...new Set((tagNames ?? []).map(normalizeTagName).filter(Boolean))];

  const transaction = db.transaction(() => {
    statements.clearNoteTagsStatement.run(noteId);

    for (const tagName of normalizedNames) {
      const tag = ensureTag(tagName);
      if (tag) {
        statements.insertNoteTagStatement.run(noteId, tag.id);
      }
    }
  });

  transaction();
}

function importNotes(notes) {
  getDatabase();

  const transaction = db.transaction((rows) => {
    const existingRows = statements.listImportRowsStatement.all();
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
        replaceNoteTags(existing.id, note.tags);
        matchedIds.add(existing.id);
        identityToRow.set(identity, {
          ...existing,
          ...note,
          id: existing.id,
          display_order: nextDisplayOrder
        });
        updatedCount += 1;
      } else {
        const result = statements.upsertBanknoteStatement.run({
          ...note,
          display_order: nextDisplayOrder
        });
        const noteId = Number(result.lastInsertRowid);
        replaceNoteTags(noteId, note.tags);

        identityToRow.set(identity, {
          id: noteId,
          ...note,
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

function getNextDisplayOrder() {
  getDatabase();
  const row = statements.maxDisplayOrderStatement.get();
  return Number(row?.value ?? 0) + 1;
}

function updateNote(note) {
  getDatabase();
  const normalizedImages = normalizeImages(note.images ?? []);

  const transaction = db.transaction((payload) => {
    statements.updateNoteStatement.run({
      ...payload,
      scraped_data: payload.scraped_data ? JSON.stringify(payload.scraped_data) : null,
      images: JSON.stringify(normalizedImages)
    });
    replaceNoteTags(payload.id, payload.tags);
  });

  transaction(note);
  removeStaleManagedFiles(IMAGES_DIR, note.id, normalizedImages);
  return getNoteById(note.id);
}

function createNote(note) {
  getDatabase();
  const normalizedImages = normalizeImages(note.images ?? []);

  const transaction = db.transaction((payload) => {
    const result = statements.insertNoteStatement.run({
      ...payload,
      scraped_data: payload.scraped_data ? JSON.stringify(payload.scraped_data) : null,
      images: JSON.stringify(normalizedImages),
      display_order: getNextDisplayOrder()
    });
    const noteId = Number(result.lastInsertRowid);
    replaceNoteTags(noteId, payload.tags);
    return noteId;
  });

  const noteId = transaction(note);
  return getNoteById(noteId);
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

function deleteNote(id) {
  getDatabase();
  const existing = statements.getNoteStatement.get(id);

  if (!existing) {
    return;
  }

  const transaction = db.transaction((noteId, displayOrder) => {
    statements.deleteNoteStatement.run(noteId);
    statements.compactDisplayOrderAfterDeleteStatement.run(displayOrder);
  });

  transaction(id, existing.display_order);
  removeManagedNoteImages(id);
}

function reorderNotes(ids) {
  getDatabase();
  const normalizedIds = ids.map((id) => Number(id));
  const allNotes = getAllNotes();
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
  return getAllNotes();
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
  createNote,
  createSlideshowSession,
  deleteNote,
  ensureTag,
  getAllNotes,
  getAllTags,
  getDatabase,
  getNoteById,
  getNotesByIds,
  getSlideshowSession,
  importNotes,
  openDatabase,
  reloadDatabase,
  reorderNotes,
  replaceNoteTags,
  updateNote,
  updateScrapeResult,
  verifyDatabaseFile
};
