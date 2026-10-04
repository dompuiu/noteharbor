import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let serverModule;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-health-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
});

after(async () => {
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('health is ok when the database ping answers', () => {
  assert.deepEqual(serverModule.checkHealth(() => {}), {
    status: 200,
    body: { ok: true }
  });
});

test('health reports unavailable when the database ping throws', () => {
  assert.deepEqual(
    serverModule.checkHealth(() => {
      throw new Error('database unavailable');
    }),
    { status: 503, body: { ok: false } }
  );
});
