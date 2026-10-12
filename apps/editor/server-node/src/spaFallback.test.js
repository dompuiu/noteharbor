import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let serverModule;
let tempDir;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-spa-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
});

after(async () => {
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Mirror the packaged desktop build: the web UI lives under a dot-directory
// (app.asar/.build/web-dist), which is what the fallback must tolerate.
function makeWebDist() {
  const webDistDir = fs.mkdtempSync(path.join(tempDir, 'webdist-'));
  const dotBuildDir = path.join(webDistDir, '.build', 'web-dist');
  fs.mkdirSync(path.join(dotBuildDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(dotBuildDir, 'index.html'),
    '<!doctype html><html><body>note-harbor-spa-entry</body></html>'
  );
  fs.writeFileSync(path.join(dotBuildDir, 'assets', 'app.js'), 'console.log(1);');
  return dotBuildDir;
}

function withWebDistEnv(webDistDir, run) {
  const previousServe = process.env.NOTE_HARBOR_SERVE_WEB_DIST;
  const previousDir = process.env.NOTE_HARBOR_WEB_DIST_DIR;
  process.env.NOTE_HARBOR_SERVE_WEB_DIST = 'true';
  process.env.NOTE_HARBOR_WEB_DIST_DIR = webDistDir;
  try {
    return run();
  } finally {
    if (previousServe === undefined) {
      delete process.env.NOTE_HARBOR_SERVE_WEB_DIST;
    } else {
      process.env.NOTE_HARBOR_SERVE_WEB_DIST = previousServe;
    }
    if (previousDir === undefined) {
      delete process.env.NOTE_HARBOR_WEB_DIST_DIR;
    } else {
      process.env.NOTE_HARBOR_WEB_DIST_DIR = previousDir;
    }
  }
}

function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve) => {
    server.once('listening', () => resolve({ server, port: server.address().port }));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('a non-root SPA route serves the entry even under a dot-directory', async () => {
  const webDistDir = makeWebDist();
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  const { server, port } = await listen(app);

  try {
    // The post-import destination in the Editor.
    const response = await fetch(`http://127.0.0.1:${port}/catalog/collections`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /note-harbor-spa-entry/);
  } finally {
    await close(server);
  }
});

test('a missing static asset falls back to the SPA entry', async () => {
  const webDistDir = makeWebDist();
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  const { server, port } = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/assets/does-not-exist.js`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /note-harbor-spa-entry/);
  } finally {
    await close(server);
  }
});

test('an unknown API route answers a JSON 404', async () => {
  const webDistDir = makeWebDist();
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  const { server, port } = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const payload = await response.json();
    assert.ok(typeof payload.error === 'string' && payload.error.length > 0);
  } finally {
    await close(server);
  }
});

test('a missing SPA entry answers a JSON error instead of an HTML error page', async () => {
  const webDistDir = makeWebDist();
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  fs.rmSync(path.join(webDistDir, 'index.html'));
  const { server, port } = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/catalog/collections`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const payload = await response.json();
    assert.ok(typeof payload.error === 'string' && payload.error.length > 0);
  } finally {
    await close(server);
  }
});

test('a missing SPA entry at startup answers a JSON error', async () => {
  const webDistDir = makeWebDist();
  fs.rmSync(path.join(webDistDir, 'index.html'));
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  const { server, port } = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/catalog/collections`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    const payload = await response.json();
    assert.ok(typeof payload.error === 'string' && payload.error.length > 0);
  } finally {
    await close(server);
  }
});

test('a non-API path sharing the /api prefix still serves the SPA entry', async () => {
  const webDistDir = makeWebDist();
  const app = withWebDistEnv(webDistDir, () => serverModule.createApp());
  const { server, port } = await listen(app);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/apiary-trails`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /note-harbor-spa-entry/);
  } finally {
    await close(server);
  }
});
