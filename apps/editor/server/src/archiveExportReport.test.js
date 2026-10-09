import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import unzipper from 'unzipper';

// Ticket 15: a filtered export reports the Showcases it had to omit through a
// response header, so the client can tell the user what did not travel. This
// drives the real HTTP route at the export seam.

let serverModule;
let db;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-archive-report-'));
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

function createNote(collectionId, denomination) {
  return db.createNote({
    collection_id: collectionId,
    denomination,
    issue_date: '1920',
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
}

function readOmittedShowcases(response) {
  const header = response.headers.get('x-noteharbor-omitted-showcases');
  assert.ok(header, 'expected the X-NoteHarbor-Omitted-Showcases header');
  return JSON.parse(decodeURIComponent(header));
}

test('a filtered export reports the showcase that reached outside the selection', async () => {
  const keptCollection = db.createCollection('Report Kept');
  const otherCollection = db.createCollection('Report Other');
  const keptNote = createNote(keptCollection.id, 'Kept');
  const otherNote = createNote(otherCollection.id, 'Other');

  const inside = db.createShowcase('Report Inside');
  const insideCategory = db.addShowcaseNode(inside.id, { type: 'category', name: 'Inside Label' });
  db.addShowcaseNode(inside.id, { type: 'notes', parent_id: insideCategory.id, note_ids: [keptNote.id] });

  const outside = db.createShowcase('Report Outside');
  const outsideCategory = db.addShowcaseNode(outside.id, { type: 'category', name: 'Outside Label' });
  db.addShowcaseNode(outside.id, { type: 'notes', parent_id: outsideCategory.id, note_ids: [otherNote.id] });

  const response = await fetch(
    `${baseUrl}/api/archive/export?collectionIds=${keptCollection.id}`
  );

  try {
    assert.equal(response.status, 200);
    assert.deepEqual(readOmittedShowcases(response), ['Report Outside']);
  } finally {
    await response.arrayBuffer();
  }
});

test('an unfiltered export reports no omitted showcases', async () => {
  const response = await fetch(`${baseUrl}/api/archive/export`);

  try {
    assert.equal(response.status, 200);
    assert.deepEqual(readOmittedShowcases(response), []);
  } finally {
    await response.arrayBuffer();
  }
});

test('an unfiltered export carries the three showcase tables inside the archive', async () => {
  const collection = db.createCollection('Archive Carry');
  const note = createNote(collection.id, 'Carry');
  const showcase = db.createShowcase('Carried Showcase');
  const category = db.addShowcaseNode(showcase.id, { type: 'category', name: 'Carried Label' });
  db.addShowcaseNode(showcase.id, { type: 'notes', parent_id: category.id, note_ids: [note.id] });

  const response = await fetch(`${baseUrl}/api/archive/export`);
  assert.equal(response.status, 200);

  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const directory = await unzipper.Open.buffer(archiveBuffer);
  const dbEntry = directory.files.find((entry) => entry.path === 'banknotes.db');
  assert.ok(dbEntry, 'expected the archive to contain banknotes.db');

  const extractedDbPath = path.join(tempDir, 'exported-archive.db');
  fs.writeFileSync(extractedDbPath, await dbEntry.buffer());

  const archiveDb = new Database(extractedDbPath, { readonly: true });
  try {
    assert.ok(
      archiveDb.prepare(`SELECT name FROM showcases ORDER BY id`).all().map((row) => row.name).includes('Carried Showcase')
    );
    assert.ok(
      archiveDb.prepare(`SELECT name FROM categories ORDER BY id`).all().map((row) => row.name).includes('Carried Label')
    );

    const carriedNodes = archiveDb.prepare(`
      SELECT node_type, note_id, category_id
      FROM showcase_nodes
      WHERE showcase_id = (SELECT id FROM showcases WHERE name = 'Carried Showcase')
      ORDER BY id
    `).all();
    assert.equal(carriedNodes.length, 2);
    assert.equal(carriedNodes[0].node_type, 'category');
    assert.equal(
      carriedNodes[0].category_id,
      archiveDb.prepare(`SELECT id FROM categories WHERE name = 'Carried Label'`).get().id
    );
    assert.equal(carriedNodes[1].node_type, 'note');
    assert.equal(
      carriedNodes[1].note_id,
      archiveDb.prepare(`SELECT id FROM banknotes WHERE denomination = 'Carry'`).get().id
    );
    assert.deepEqual(archiveDb.prepare(`PRAGMA foreign_key_check`).all(), []);
  } finally {
    archiveDb.close();
  }
});
