import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const SCRAPED_IMAGES_DIR = path.join(IMAGES_DIR, 'scraped');
const DB_PATH = path.join(DATA_DIR, 'banknotes.db');

fs.mkdirSync(SCRAPED_IMAGES_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS banknotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(catalog_number, serial)
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
`);

const noteFields = `
  id,
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

const listNotesStatement = db.prepare(`SELECT ${noteFields} FROM banknotes ORDER BY id ASC`);
const getNoteStatement = db.prepare(`SELECT ${noteFields} FROM banknotes WHERE id = ?`);
const listTagsForNotesStatement = db.prepare(`
  SELECT bt.banknote_id, t.id, t.name
  FROM banknote_tags bt
  INNER JOIN tags t ON t.id = bt.tag_id
  ORDER BY t.name COLLATE NOCASE ASC
`);
const listAllTagsStatement = db.prepare(`SELECT id, name FROM tags ORDER BY name COLLATE NOCASE ASC`);
const insertTagStatement = db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`);
const getTagByNameStatement = db.prepare(`SELECT id, name FROM tags WHERE name = ?`);
const clearNoteTagsStatement = db.prepare(`DELETE FROM banknote_tags WHERE banknote_id = ?`);
const insertNoteTagStatement = db.prepare(`INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id) VALUES (?, ?)`);
const upsertBanknoteStatement = db.prepare(`
  INSERT INTO banknotes (
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
  VALUES (@denomination, @issue_date, @catalog_number, @grading_company, @grade, @watermark, @serial, @url, @notes, datetime('now'))
  ON CONFLICT(catalog_number, serial) DO NOTHING
`);
const updateNoteStatement = db.prepare(`
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
`);
const updateScrapeStatement = db.prepare(`
  UPDATE banknotes
  SET scraped_data = @scraped_data,
      images = @images,
      scrape_status = @scrape_status,
      scrape_error = @scrape_error,
      updated_at = datetime('now')
  WHERE id = @id
`);

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

function rowToNote(row, tagMap) {
  return {
    ...row,
    scraped_data: parseJson(row.scraped_data, null),
    images: parseJson(row.images, []),
    tags: tagMap.get(row.id) ?? []
  };
}

function buildTagMap() {
  const tagMap = new Map();

  for (const row of listTagsForNotesStatement.all()) {
    if (!tagMap.has(row.banknote_id)) {
      tagMap.set(row.banknote_id, []);
    }

    tagMap.get(row.banknote_id).push({ id: row.id, name: row.name });
  }

  return tagMap;
}

function getAllNotes() {
  const tagMap = buildTagMap();
  return listNotesStatement.all().map((row) => rowToNote(row, tagMap));
}

function getNoteById(id) {
  const row = getNoteStatement.get(id);

  if (!row) {
    return null;
  }

  return rowToNote(row, buildTagMap());
}

function getNotesByIds(ids) {
  if (!ids.length) {
    return [];
  }

  const placeholders = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
  const statement = db.prepare(`SELECT ${noteFields} FROM banknotes WHERE id IN (${ids.map((_, index) => `@id${index}`).join(', ')})`);
  const tagMap = buildTagMap();
  return statement.all(placeholders).map((row) => rowToNote(row, tagMap));
}

function getAllTags() {
  return listAllTagsStatement.all();
}

function ensureTag(name) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    return null;
  }

  insertTagStatement.run(normalizedName);
  return getTagByNameStatement.get(normalizedName);
}

function seedTagSuggestions(tagNames) {
  const uniqueNames = [...new Set(tagNames.map(normalizeTagName).filter(Boolean))];

  const transaction = db.transaction((names) => {
    for (const name of names) {
      insertTagStatement.run(name);
    }
  });

  transaction(uniqueNames);
}

function upsertImportedNote(note) {
  return upsertBanknoteStatement.run(note);
}

function replaceNoteTags(noteId, tagNames) {
  const normalizedNames = [...new Set((tagNames ?? []).map(normalizeTagName).filter(Boolean))];

  const transaction = db.transaction(() => {
    clearNoteTagsStatement.run(noteId);

    for (const tagName of normalizedNames) {
      const tag = ensureTag(tagName);
      if (tag) {
        insertNoteTagStatement.run(noteId, tag.id);
      }
    }
  });

  transaction();
}

function updateNote(note) {
  const transaction = db.transaction((payload) => {
    updateNoteStatement.run(payload);
    replaceNoteTags(payload.id, payload.tags);
  });

  transaction(note);
  return getNoteById(note.id);
}

function updateScrapeResult({ id, scrapedData, images, scrapeStatus, scrapeError }) {
  updateScrapeStatement.run({
    id,
    scraped_data: scrapedData ? JSON.stringify(scrapedData) : null,
    images: images ? JSON.stringify(images) : JSON.stringify([]),
    scrape_status: scrapeStatus,
    scrape_error: scrapeError ?? null
  });

  return getNoteById(id);
}

export {
  DATA_DIR,
  DB_PATH,
  IMAGES_DIR,
  ROOT_DIR,
  SCRAPED_IMAGES_DIR,
  ensureTag,
  getAllNotes,
  getAllTags,
  getNoteById,
  getNotesByIds,
  replaceNoteTags,
  seedTagSuggestions,
  updateNote,
  updateScrapeResult,
  upsertImportedNote
};
