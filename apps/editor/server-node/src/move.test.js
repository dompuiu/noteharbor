import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let db;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-move-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  db = await import('./db.js');
});

after(() => {
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeNotePayload(collectionId, overrides = {}) {
  return {
    collection_id: collectionId,
    denomination: '',
    issue_date: '',
    catalog_number: '',
    grading_company: '',
    grade: '',
    watermark: '',
    serial: '',
    url: '',
    notes: '',
    tags: [],
    scraped_data: null,
    images: [],
    ...overrides
  };
}

function orderedIds(collectionId) {
  return db.getAllNotes(collectionId).map((note) => note.id);
}

test('moveNoteToCollection reassigns collection_id and appends to an empty destination', () => {
  const source = db.createCollection('Move Source A');
  const target = db.createCollection('Move Target A');
  const note = db.createNote(makeNotePayload(source.id, { denomination: '100 Lei' }));

  const moved = db.moveNoteToCollection(note.id, source.id, target.id, { mode: 'end' });

  assert.equal(moved.collection_id, target.id);
  assert.equal(moved.display_order, 1);
  assert.deepEqual(orderedIds(target.id), [note.id]);
  assert.deepEqual(orderedIds(source.id), []);
});

test('moveNoteToCollection with before/after against an empty destination falls back to placing the note alone', () => {
  const source = db.createCollection('Move Source B');
  const target = db.createCollection('Move Target B');
  const note = db.createNote(makeNotePayload(source.id));

  const moved = db.moveNoteToCollection(note.id, source.id, target.id, {
    mode: 'before',
    referenceId: 999999
  });

  assert.equal(moved.collection_id, target.id);
  assert.deepEqual(orderedIds(target.id), [note.id]);
});

test('moveNoteToCollection positions the note correctly for start/before/after and compacts the source order', () => {
  const source = db.createCollection('Move Source C');
  const target = db.createCollection('Move Target C');

  const noteA = db.createNote(makeNotePayload(source.id, { notes: 'A' }));
  const noteB = db.createNote(makeNotePayload(source.id, { notes: 'B' }));
  const noteC = db.createNote(makeNotePayload(source.id, { notes: 'C' }));

  const noteX = db.createNote(makeNotePayload(target.id, { notes: 'X' }));
  const noteY = db.createNote(makeNotePayload(target.id, { notes: 'Y' }));

  db.moveNoteToCollection(noteB.id, source.id, target.id, {
    mode: 'before',
    referenceId: noteY.id
  });

  assert.deepEqual(orderedIds(target.id), [noteX.id, noteB.id, noteY.id]);
  // Source order compacted: no gap left where B used to be.
  assert.deepEqual(orderedIds(source.id), [noteA.id, noteC.id]);
  assert.deepEqual(
    db.getAllNotes(source.id).map((note) => note.display_order),
    [1, 2]
  );

  db.moveNoteToCollection(noteA.id, source.id, target.id, { mode: 'start' });
  assert.deepEqual(orderedIds(target.id), [noteA.id, noteX.id, noteB.id, noteY.id]);

  db.moveNoteToCollection(noteC.id, source.id, target.id, {
    mode: 'after',
    referenceId: noteX.id
  });
  assert.deepEqual(orderedIds(target.id), [noteA.id, noteX.id, noteC.id, noteB.id, noteY.id]);
  assert.deepEqual(orderedIds(source.id), []);
});

test('moveNoteToCollection re-matches tags by name into the destination without duplicating shared tags', () => {
  const source = db.createCollection('Move Source D');
  const target = db.createCollection('Move Target D');

  const note1 = db.createNote(makeNotePayload(source.id, { tags: ['Rare'] }));
  const note2 = db.createNote(makeNotePayload(source.id, { tags: ['Rare'] }));
  db.createNote(makeNotePayload(target.id, { tags: ['Rare'] }));

  const moved = db.moveNoteToCollection(note1.id, source.id, target.id, { mode: 'end' });

  assert.deepEqual(moved.tags.map((tag) => tag.name), ['Rare']);
  assert.equal(db.getAllTags(target.id).length, 1, 'find-or-create should reuse the existing target tag');

  // note2 still lives in source and still uses the source's "Rare" tag row.
  const remainingSourceTags = db.getAllTags(source.id);
  assert.equal(remainingSourceTags.length, 1);
  assert.equal(remainingSourceTags[0].name, 'Rare');
  assert.deepEqual(db.getNoteById(note2.id, source.id).tags.map((tag) => tag.name), ['Rare']);
});

test('moveNoteToCollection rejects moving into the same collection', () => {
  const source = db.createCollection('Move Source E');
  const note = db.createNote(makeNotePayload(source.id));

  assert.throws(
    () => db.moveNoteToCollection(note.id, source.id, source.id, { mode: 'end' }),
    /already in this collection/
  );
});

test('moveNoteToCollection rejects a missing target collection', () => {
  const source = db.createCollection('Move Source F');
  const note = db.createNote(makeNotePayload(source.id));

  assert.throws(
    () => db.moveNoteToCollection(note.id, source.id, 999999, { mode: 'end' }),
    /Collection not found/
  );
});
