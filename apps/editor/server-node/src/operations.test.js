import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Operations seam: GET /api/operations/status while idle and while busy.

let serverModule;
let operationState;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-operations-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  operationState = await import('./operationState.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  operationState.endOperation();
  await new Promise((resolve) => server.close(resolve));
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('status reports idle with no operation running', async () => {
  operationState.endOperation();
  const response = await fetch(`${baseUrl}/api/operations/status`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    currentOperation: 'idle',
    isBusy: false,
    startedAt: null,
    details: null
  });
});

test('status reports the running operation and its details', async () => {
  operationState.beginOperation('exporting_archive', { step: 'zip' });
  try {
    const response = await fetch(`${baseUrl}/api/operations/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.currentOperation, 'exporting_archive');
    assert.equal(body.isBusy, true);
    assert.equal(typeof body.startedAt, 'string');
    assert.deepEqual(body.details, { step: 'zip' });
  } finally {
    operationState.endOperation();
  }
});
