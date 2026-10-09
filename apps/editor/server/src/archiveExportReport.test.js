import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
