import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import unzipper from 'unzipper';
import {
  DATA_DIR,
  DB_PATH,
  IMAGES_DIR,
  backupDatabase,
  closeDatabase,
  getAllNotes,
  reloadDatabase,
  verifyDatabaseFile
} from '../db.js';
import { withExclusiveOperation } from '../operationState.js';

const archiveRouter = Router();
const upload = multer({ dest: os.tmpdir() });

function removePathIfExists(targetPath) {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function isInsideDirectory(rootDir, candidatePath) {
  const relativePath = path.relative(rootDir, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

async function extractArchive(zipPath, outputDir) {
  const directory = await unzipper.Open.file(zipPath);

  for (const entry of directory.files) {
    const destinationPath = path.resolve(outputDir, entry.path);

    if (!isInsideDirectory(outputDir, destinationPath)) {
      throw new Error('Archive contains invalid file paths.');
    }

    if (entry.type === 'Directory') {
      fs.mkdirSync(destinationPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    await pipeline(entry.stream(), fs.createWriteStream(destinationPath));
  }
}

function findArchiveDataDir(rootDir) {
  const queue = [rootDir];
  const visited = new Set();

  while (queue.length) {
    const currentDir = queue.shift();

    if (visited.has(currentDir)) {
      continue;
    }

    visited.add(currentDir);

    const dbPath = path.join(currentDir, 'banknotes.db');
    const imagesPath = path.join(currentDir, 'images');

    if (fs.existsSync(dbPath) && fs.existsSync(imagesPath) && fs.statSync(imagesPath).isDirectory()) {
      return currentDir;
    }

    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        queue.push(path.join(currentDir, entry.name));
      }
    }
  }

  return null;
}

function createStageDir() {
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(DATA_DIR), '.noteharbor-stage-'));
  const stagedDataDir = path.join(stageRoot, path.basename(DATA_DIR));
  fs.mkdirSync(stagedDataDir, { recursive: true });
  return { stageRoot, stagedDataDir };
}

function createEmptyStagedDataDir() {
  return createStageDir();
}

function prepareStagedDataDir(sourceDataDir) {
  const { stageRoot, stagedDataDir } = createStageDir();
  const stagedImagesDir = path.join(stagedDataDir, 'images');

  fs.copyFileSync(path.join(sourceDataDir, 'banknotes.db'), path.join(stagedDataDir, 'banknotes.db'));
  copyDirectory(path.join(sourceDataDir, 'images'), stagedImagesDir);

  return { stageRoot, stagedDataDir };
}

function swapInImportedData(stagedDataDir) {
  const dataParentDir = path.dirname(DATA_DIR);
  const backupRoot = fs.mkdtempSync(path.join(dataParentDir, '.noteharbor-backup-'));
  const backupDataDir = path.join(backupRoot, path.basename(DATA_DIR));
  let previousDataMoved = false;

  closeDatabase();

  try {
    fs.mkdirSync(dataParentDir, { recursive: true });

    if (fs.existsSync(DATA_DIR)) {
      fs.renameSync(DATA_DIR, backupDataDir);
      previousDataMoved = true;
    }

    fs.renameSync(stagedDataDir, DATA_DIR);
    reloadDatabase();
    getAllNotes();
    removePathIfExists(backupRoot);
  } catch (error) {
    try {
      closeDatabase();
      removePathIfExists(DATA_DIR);

      if (previousDataMoved && fs.existsSync(backupDataDir)) {
        fs.renameSync(backupDataDir, DATA_DIR);
      }

      reloadDatabase();
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }

    throw error;
  }
}

archiveRouter.get('/export', async (_request, response) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-export-'));
  const snapshotDbPath = path.join(tempRoot, 'banknotes.db');

  try {
    await withExclusiveOperation('exporting_archive', null, async () => {
      await backupDatabase(snapshotDbPath);

      response.setHeader('Content-Type', 'application/zip');
      response.setHeader('Content-Disposition', `attachment; filename="noteharbor-archive-${new Date().toISOString().slice(0, 10)}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });

      await new Promise((resolve, reject) => {
        let settled = false;

        function finish() {
          if (settled) {
            return;
          }

          settled = true;
          resolve();
        }

        function fail(error) {
          if (settled) {
            return;
          }

          settled = true;
          reject(error);
        }

        response.on('finish', finish);
        response.on('close', finish);
        response.on('error', fail);
        archive.on('error', fail);

        archive.pipe(response);
        archive.file(snapshotDbPath, { name: 'banknotes.db' });

        if (fs.existsSync(IMAGES_DIR)) {
          archive.directory(IMAGES_DIR, 'images');
        }

        archive.finalize().catch(fail);
      });
    });
  } catch (error) {
    if (!response.headersSent) {
      response.status(error.statusCode || 500).json({ error: error.message, currentOperation: error.currentOperation });
    } else {
      response.destroy(error);
    }
  } finally {
    removePathIfExists(tempRoot);
  }
});

archiveRouter.post('/import', upload.single('file'), async (request, response) => {
  const uploadPath = request.file?.path;

  if (!uploadPath) {
    response.status(400).json({ error: 'Archive file is required.' });
    return;
  }

  const extractedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-import-'));
  let stageRoot = null;

  try {
    const payload = await withExclusiveOperation('importing_archive', null, async () => {
      await extractArchive(uploadPath, extractedRoot);

      const archiveDataDir = findArchiveDataDir(extractedRoot);

      if (!archiveDataDir) {
        throw new Error('Archive must contain a banknotes.db file and an images directory.');
      }

      verifyDatabaseFile(path.join(archiveDataDir, 'banknotes.db'));

      const staged = prepareStagedDataDir(archiveDataDir);
      stageRoot = staged.stageRoot;
      swapInImportedData(staged.stagedDataDir);

      return {
        success: true,
        currentOperation: 'idle'
      };
    });

    response.json(payload);
  } catch (error) {
    const message = error.rollbackError
      ? `${error.message} Rollback also failed: ${error.rollbackError.message}`
      : error.message;
    response.status(error.statusCode || 500).json({ error: message, currentOperation: error.currentOperation });
  } finally {
    removePathIfExists(stageRoot);
    removePathIfExists(extractedRoot);
    removePathIfExists(uploadPath);
  }
});

archiveRouter.delete('/data', async (_request, response) => {
  let stageRoot = null;

  try {
    const payload = await withExclusiveOperation('clearing_data', null, async () => {
      const staged = createEmptyStagedDataDir();
      stageRoot = staged.stageRoot;
      swapInImportedData(staged.stagedDataDir);

      return {
        success: true,
        currentOperation: 'idle'
      };
    });

    response.json(payload);
  } catch (error) {
    const message = error.rollbackError
      ? `${error.message} Rollback also failed: ${error.rollbackError.message}`
      : error.message;
    response.status(error.statusCode || 500).json({ error: message, currentOperation: error.currentOperation });
  } finally {
    removePathIfExists(stageRoot);
  }
});

export { archiveRouter };
