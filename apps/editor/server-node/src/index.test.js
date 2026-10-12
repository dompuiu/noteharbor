import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

let serverModule;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-index-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
});

after(async () => {
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function startRouteApp(registerRoute) {
  const app = express();
  app.set('env', 'test');
  registerRoute(app);
  app.use(serverModule.databaseErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    server.once('listening', () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('recognises better-sqlite3 availability failures as database outages', () => {
  assert.equal(serverModule.isDatabaseUnavailable({ code: 'SQLITE_CANTOPEN' }), true);
  assert.equal(serverModule.isDatabaseUnavailable({ code: 'SQLITE_BUSY' }), true);
  assert.equal(serverModule.isDatabaseUnavailable({ code: 'SQLITE_IOERR_READ' }), true);
  // Constraint failures are client mistakes, not an outage.
  assert.equal(serverModule.isDatabaseUnavailable({ code: 'SQLITE_CONSTRAINT_UNIQUE' }), false);
  assert.equal(serverModule.isDatabaseUnavailable(new Error('boom')), false);
  assert.equal(serverModule.isDatabaseUnavailable(null), false);
});

test('a database failure answers 503 so the client can report it', async () => {
  const { server, port } = await startRouteApp((app) => {
    app.get('/boom', () => {
      const error = new Error('unable to open database file');
      error.code = 'SQLITE_CANTOPEN';
      throw error;
    });
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Database unavailable.' });
  } finally {
    await close(server);
  }
});

test('a non-database failure is left to the default handler', async () => {
  const { server, port } = await startRouteApp((app) => {
    app.get('/boom', () => {
      throw new Error('kaboom');
    });
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/boom`);
    assert.equal(response.status, 500);
  } finally {
    await close(server);
  }
});
