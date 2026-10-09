import fs from 'node:fs';
import path from 'node:path';

try { process.loadEnvFile(); } catch { /* no .env file, use defaults */ }
import { fileURLToPath, pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { IMAGES_DIR, ROOT_DIR, pingDatabase } from './db.js';
import { archiveRouter } from './routes/archive.js';
import { categoriesRouter } from './routes/categories.js';
import { collectionsRouter } from './routes/collections.js';
import { notesRouter } from './routes/notes.js';
import { operationsRouter } from './routes/operations.js';
import { scrapeRouter } from './routes/scrape.js';
import { nodesRouter, showcasesRouter } from './routes/showcases.js';
import { tagsRouter } from './routes/tags.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3001;

function parseBooleanEnv(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveWebDistDir() {
  return path.resolve(process.env.NOTE_HARBOR_WEB_DIST_DIR || path.join(ROOT_DIR, 'apps/editor/web/dist'));
}

function shouldServeWebDist() {
  return parseBooleanEnv(process.env.NOTE_HARBOR_SERVE_WEB_DIST);
}

// The probe the client uses to tell "database unreachable" apart from an empty
// library. `ping` is injectable so both outcomes are testable without having to
// break a real database.
function checkHealth(ping = pingDatabase) {
  try {
    ping();
    return { status: 200, body: { ok: true } };
  } catch {
    return { status: 503, body: { ok: false } };
  }
}

// better-sqlite3 reports failures with a SQLITE_* code. Only the availability
// codes mean the database can't be reached — constraint failures are client
// mistakes, not an outage. The client reads the shell's connection state from
// the collections load, so map availability errors to 503, the same signal
// /api/health uses.
const DATABASE_UNAVAILABLE_PREFIXES = [
  'SQLITE_BUSY',
  'SQLITE_CANTOPEN',
  'SQLITE_CORRUPT',
  'SQLITE_IOERR',
  'SQLITE_LOCKED',
  'SQLITE_NOTADB',
  'SQLITE_PERM',
  'SQLITE_READONLY'
];

function isDatabaseUnavailable(error) {
  if (typeof error?.code !== 'string') {
    return false;
  }

  return DATABASE_UNAVAILABLE_PREFIXES.some(
    (prefix) => error.code === prefix || error.code.startsWith(`${prefix}_`)
  );
}

function databaseErrorHandler(error, _request, response, next) {
  if (isDatabaseUnavailable(error)) {
    response.status(503).json({ error: 'Database unavailable.' });
    return;
  }

  next(error);
}

function createApp() {
  const app = express();
  const webDistDir = resolveWebDistDir();
  const webEntryPath = path.join(webDistDir, 'index.html');

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/archive', archiveRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/images', express.static(IMAGES_DIR));
  app.use('/api/collections/:collectionId/notes', notesRouter);
  app.use('/api/collections/:collectionId/tags', tagsRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/nodes', nodesRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/operations', operationsRouter);
  app.use('/api/showcases', showcasesRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/scrape', scrapeRouter);

  app.get('/api/health', (_request, response) => {
    const { status, body } = checkHealth();
    response.status(status).json(body);
  });

  app.use(databaseErrorHandler);

  if (shouldServeWebDist() && fs.existsSync(webEntryPath)) {
    app.use(express.static(webDistDir));
    app.get(/^(?!\/api(?:\/|$)).*/, (_request, response) => {
      response.sendFile(webEntryPath);
    });
  }

  return app;
}

function startServer({ host = process.env.HOST || DEFAULT_HOST, port = Number(process.env.PORT || DEFAULT_PORT) } = {}) {
  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const activePort = typeof address === 'object' && address ? address.port : port;
      console.log(`Server listening on http://${host}:${activePort}`);
      resolve({ app, host, port: activePort, server });
    });

    server.on('error', (error) => reject(error));
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  checkHealth,
  createApp,
  databaseErrorHandler,
  isDatabaseUnavailable,
  resolveWebDistDir,
  startServer
};
