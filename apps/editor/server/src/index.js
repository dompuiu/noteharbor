import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { IMAGES_DIR, ROOT_DIR } from './db.js';
import { archiveRouter } from './routes/archive.js';
import { importRouter } from './routes/import.js';
import { notesRouter } from './routes/notes.js';
import { operationsRouter } from './routes/operations.js';
import { scrapeRouter } from './routes/scrape.js';
import { slideshowRouter } from './routes/slideshow.js';
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

function createApp() {
  const app = express();
  const webDistDir = resolveWebDistDir();
  const webEntryPath = path.join(webDistDir, 'index.html');

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/archive', archiveRouter);
  app.use('/api/images', express.static(IMAGES_DIR));
  app.use('/api/import', importRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/operations', operationsRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/scrape', scrapeRouter);
  app.use('/api/slideshow', slideshowRouter);

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

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
  createApp,
  resolveWebDistDir,
  startServer
};
