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

test('the health route answers 200 with ok:true when the database answers', async () => {
  const { server, port } = await serverModule.startServer({
    host: '127.0.0.1',
    port: 0
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
