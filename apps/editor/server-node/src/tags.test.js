import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Tags seam: HTTP GET /api/collections/:id/tags (+ /suggestions, /api/tags).

let serverModule;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-tags-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test('a fresh collection reports no tags', async () => {
  const { body: created } = await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tags Empty' })
  });
  const { response, body } = await api(`/api/collections/${created.collection.id}/tags`);
  assert.equal(response.status, 200);
  assert.deepEqual(body.tags, []);
});

test('tags used by notes are listed once and sorted', async () => {
  const { body: created } = await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tags Listed' })
  });
  const collectionId = created.collection.id;

  await api(`/api/collections/${collectionId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '5 Lei', tags: ['bimetal', 'anchor'] })
  });
  await api(`/api/collections/${collectionId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '10 Lei', tags: ['anchor', 'commemorative'] })
  });

  const { body } = await api(`/api/collections/${collectionId}/tags`);
  assert.deepEqual(body.tags.map((tag) => tag.name), ['anchor', 'bimetal', 'commemorative']);
});

test('suggestions mirror the tag list', async () => {
  const { body: created } = await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tags Suggestions' })
  });
  await api(`/api/collections/${created.collection.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '5 Lei', tags: ['paper'] })
  });

  const { response, body } = await api(`/api/collections/${created.collection.id}/tags/suggestions`);
  assert.equal(response.status, 200);
  assert.deepEqual(body.tags.map((tag) => tag.name), ['paper']);
});

test('tags are scoped per collection', async () => {
  const first = (await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tags Scope A' })
  })).body.collection;
  const second = (await api('/api/collections', {
    method: 'POST',
    body: JSON.stringify({ name: 'Tags Scope B' })
  })).body.collection;

  await api(`/api/collections/${first.id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ denomination: '5 Lei', tags: ['only-a'] })
  });

  const { body } = await api(`/api/collections/${second.id}/tags`);
  assert.deepEqual(body.tags, []);
});

test('an invalid collection id answers 400 and an unknown one 404', async () => {
  const bad = await api('/api/collections/nope/tags');
  assert.equal(bad.response.status, 400);

  const missing = await api('/api/collections/999999/tags');
  assert.equal(missing.response.status, 404);
});
