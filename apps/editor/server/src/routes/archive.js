import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import multer from 'multer';
import archiver from 'archiver';
import unzipper from 'unzipper';
import Database from 'better-sqlite3';
import {
  DATA_DIR,
  DB_PATH,
  IMAGES_DIR,
  backupDatabase,
  closeDatabase,
  reloadDatabase,
  verifyDatabaseFile
} from '../db.js';
import { withExclusiveOperation } from '../operationState.js';

const archiveRouter = Router();
const upload = multer({ dest: os.tmpdir() });
const IMAGE_API_PREFIX = '/api/images/';

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

function toPosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function toFsPath(rootDir, relativePosixPath) {
  return path.join(rootDir, ...String(relativePosixPath).split('/'));
}

function parseImageRecords(rawImages) {
  if (!rawImages) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawImages);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rewriteImageRecordsForImportedNote(images, archiveNoteId, stagedNoteId) {
  const copyPlan = [];
  const rewritten = [];

  for (const image of images) {
    if (!image || typeof image !== 'object') {
      continue;
    }

    const localPath = String(image.localPath ?? '');

    if (!localPath.startsWith(IMAGE_API_PREFIX)) {
      rewritten.push(image);
      continue;
    }

    const relativePath = toPosixPath(localPath.slice(IMAGE_API_PREFIX.length));
    let targetRelativePath = relativePath;
    const notePrefix = `notes/${archiveNoteId}/`;

    if (relativePath.startsWith(notePrefix)) {
      const suffix = relativePath.slice(notePrefix.length);
      targetRelativePath = `notes/${stagedNoteId}/${suffix}`;
    }

    copyPlan.push({
      fromRelativePath: relativePath,
      toRelativePath: targetRelativePath
    });

    rewritten.push({
      ...image,
      localPath: `${IMAGE_API_PREFIX}${targetRelativePath}`
    });
  }

  return { rewritten, copyPlan };
}

function copyReferencedImage(sourceImagesDir, targetImagesDir, fromRelativePath, toRelativePath) {
  const sourcePath = toFsPath(sourceImagesDir, fromRelativePath);

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return;
  }

  const targetPath = toFsPath(targetImagesDir, toRelativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
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

function archiveHasCollectionsTable(database) {
  const row = database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'collections'
    LIMIT 1
  `).get();

  return Boolean(row);
}

function listArchiveCollections(database) {
  if (!archiveHasCollectionsTable(database)) {
    throw new Error('Archive must include collections metadata.');
  }

  const rows = database.prepare(`
    SELECT id, name, COALESCE(is_default, 0) AS is_default
    FROM collections
    ORDER BY id ASC
  `).all();

  if (!rows.length) {
    throw new Error('Archive contains no collections.');
  }

  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? '').trim(),
    is_default: Number(row.is_default ?? 0) === 1 ? 1 : 0
  })).filter((row) => row.name);
}

function parseSelectedCollectionIds(rawValue) {
  if (rawValue == null) {
    return null;
  }

  const rawList = Array.isArray(rawValue)
    ? rawValue.flatMap((value) => String(value).split(','))
    : String(rawValue).split(',');

  const values = [...new Set(
    rawList
      .map((value) => Number(String(value).trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  )];

  return values;
}

function collectReferencedImageRelativePaths(database) {
  const rows = database.prepare(`SELECT images FROM banknotes`).all();
  const relativePaths = new Set();

  for (const row of rows) {
    const images = parseImageRecords(row.images);

    for (const image of images) {
      const localPath = String(image?.localPath ?? '');
      if (!localPath.startsWith(IMAGE_API_PREFIX)) {
        continue;
      }

      const relativePath = toPosixPath(localPath.slice(IMAGE_API_PREFIX.length));
      if (relativePath) {
        relativePaths.add(relativePath);
      }
    }
  }

  return relativePaths;
}

function copyReferencedImagesForExport(relativePaths, targetImagesDir) {
  fs.mkdirSync(targetImagesDir, { recursive: true });

  for (const relativePath of relativePaths) {
    const sourcePath = toFsPath(IMAGES_DIR, relativePath);

    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      continue;
    }

    const targetPath = toFsPath(targetImagesDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function buildFilteredExportSnapshot(snapshotDbPath, selectedCollectionIds, tempRoot) {
  const snapshotDatabase = new Database(snapshotDbPath);

  try {
    snapshotDatabase.pragma('foreign_keys = ON');

    const allCollectionRows = snapshotDatabase.prepare(`SELECT id FROM collections ORDER BY id ASC`).all();
    const allCollectionIds = allCollectionRows.map((row) => Number(row.id));

    const hasExplicitSelection = Array.isArray(selectedCollectionIds);
    const selectedSet = hasExplicitSelection
      ? new Set(selectedCollectionIds)
      : new Set(allCollectionIds);

    const keptCollectionIds = allCollectionIds.filter((id) => selectedSet.has(id));

    if (hasExplicitSelection && !keptCollectionIds.length) {
      throw new Error('Choose at least one valid collection to export.');
    }

    const unselectedCollectionIds = allCollectionIds.filter((id) => !selectedSet.has(id));

    if (unselectedCollectionIds.length) {
      const placeholders = unselectedCollectionIds.map(() => '?').join(', ');
      snapshotDatabase.prepare(`DELETE FROM collections WHERE id IN (${placeholders})`).run(...unselectedCollectionIds);
    }

    const referencedImages = collectReferencedImageRelativePaths(snapshotDatabase);
    const exportImagesDir = path.join(tempRoot, 'images');
    copyReferencedImagesForExport(referencedImages, exportImagesDir);

    return {
      imagesDir: exportImagesDir,
      selectedCount: keptCollectionIds.length
    };
  } finally {
    snapshotDatabase.close();
  }
}

function listArchiveTagsByNoteId(database, archiveCollectionId) {
  const rows = database.prepare(`
    SELECT bt.banknote_id AS banknote_id, t.name AS name
    FROM banknote_tags bt
    INNER JOIN tags t ON t.id = bt.tag_id
    INNER JOIN banknotes b ON b.id = bt.banknote_id
    WHERE b.collection_id = ?
    ORDER BY bt.banknote_id ASC, t.name COLLATE NOCASE ASC
  `).all(archiveCollectionId);

  const tagsByNoteId = new Map();

  for (const row of rows) {
    const banknoteId = Number(row.banknote_id);
    const tagName = String(row.name ?? '').trim();

    if (!banknoteId || !tagName) {
      continue;
    }

    if (!tagsByNoteId.has(banknoteId)) {
      tagsByNoteId.set(banknoteId, []);
    }

    tagsByNoteId.get(banknoteId).push(tagName);
  }

  return tagsByNoteId;
}

function mergeArchiveIntoStagedData(archiveDataDir, stagedDataDir) {
  const archiveDbPath = path.join(archiveDataDir, 'banknotes.db');
  const archiveImagesDir = path.join(archiveDataDir, 'images');
  const stagedDbPath = path.join(stagedDataDir, 'banknotes.db');
  const stagedImagesDir = path.join(stagedDataDir, 'images');

  const archiveDatabase = new Database(archiveDbPath, { readonly: true, fileMustExist: true });
  const stagedDatabase = new Database(stagedDbPath, { fileMustExist: true });

  const removedNoteIds = [];
  const imageCopyPlan = [];

  try {
    stagedDatabase.pragma('foreign_keys = ON');

    const archiveCollections = listArchiveCollections(archiveDatabase);

    if (!archiveCollections.length) {
      throw new Error('Archive contains no collections.');
    }

    const findCollectionByNameStatement = stagedDatabase.prepare(`
      SELECT id, name, is_default
      FROM collections
      WHERE lower(name) = lower(?)
      ORDER BY id ASC
      LIMIT 1
    `);
    const listNoteIdsByCollectionStatement = stagedDatabase.prepare(`
      SELECT id
      FROM banknotes
      WHERE collection_id = ?
      ORDER BY id ASC
    `);
    const deleteCollectionStatement = stagedDatabase.prepare(`DELETE FROM collections WHERE id = ?`);
    const insertCollectionStatement = stagedDatabase.prepare(`
      INSERT INTO collections (name, is_default, created_at, updated_at)
      VALUES (?, 0, datetime('now'), datetime('now'))
    `);
    const insertNoteStatement = stagedDatabase.prepare(`
      INSERT INTO banknotes (
        collection_id,
        display_order,
        denomination,
        issue_date,
        catalog_number,
        grading_company,
        grade,
        watermark,
        serial,
        url,
        notes,
        scraped_data,
        images,
        scrape_status,
        scrape_error,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        COALESCE(?, datetime('now')),
        COALESCE(?, datetime('now'))
      )
    `);
    const updateNoteImagesStatement = stagedDatabase.prepare(`
      UPDATE banknotes
      SET images = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    const insertTagStatement = stagedDatabase.prepare(`
      INSERT OR IGNORE INTO tags (name, collection_id)
      VALUES (?, ?)
    `);
    const getTagByNameStatement = stagedDatabase.prepare(`
      SELECT id
      FROM tags
      WHERE collection_id = ?
        AND lower(name) = lower(?)
      ORDER BY id ASC
      LIMIT 1
    `);
    const insertTagLinkStatement = stagedDatabase.prepare(`
      INSERT OR IGNORE INTO banknote_tags (banknote_id, tag_id)
      VALUES (?, ?)
    `);
    const clearDefaultStatement = stagedDatabase.prepare(`
      UPDATE collections
      SET is_default = 0,
          updated_at = datetime('now')
      WHERE is_default = 1
    `);
    const markDefaultStatement = stagedDatabase.prepare(`
      UPDATE collections
      SET is_default = 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    const importTransaction = stagedDatabase.transaction(() => {
      const importedDefaults = [];

      for (const archiveCollection of archiveCollections) {
        const existingCollection = findCollectionByNameStatement.get(archiveCollection.name);

        if (existingCollection) {
          const noteIds = listNoteIdsByCollectionStatement
            .all(Number(existingCollection.id))
            .map((row) => Number(row.id));
          removedNoteIds.push(...noteIds);
          deleteCollectionStatement.run(Number(existingCollection.id));
        }

        const insertedCollection = insertCollectionStatement.run(archiveCollection.name);
        const stagedCollectionId = Number(insertedCollection.lastInsertRowid);

        if (archiveCollection.is_default === 1) {
          importedDefaults.push({
            archiveCollectionId: archiveCollection.id,
            stagedCollectionId
          });
        }

        const tagsByNoteId = listArchiveTagsByNoteId(archiveDatabase, archiveCollection.id);
        const archiveNotes = archiveDatabase.prepare(`
          SELECT
            id,
            display_order,
            denomination,
            issue_date,
            catalog_number,
            grading_company,
            grade,
            watermark,
            serial,
            url,
            notes,
            scraped_data,
            images,
            scrape_status,
            scrape_error,
            created_at,
            updated_at
          FROM banknotes
          WHERE collection_id = ?
          ORDER BY display_order ASC, id ASC
        `).all(archiveCollection.id);

        let nextDisplayOrder = 1;

        for (const archiveNote of archiveNotes) {
          const noteInsertResult = insertNoteStatement.run(
            stagedCollectionId,
            nextDisplayOrder,
            archiveNote.denomination ?? null,
            archiveNote.issue_date ?? null,
            archiveNote.catalog_number ?? null,
            archiveNote.grading_company ?? null,
            archiveNote.grade ?? null,
            archiveNote.watermark ?? null,
            archiveNote.serial ?? null,
            archiveNote.url ?? null,
            archiveNote.notes ?? null,
            archiveNote.scraped_data ?? null,
            '[]',
            archiveNote.scrape_status ?? 'pending',
            archiveNote.scrape_error ?? null,
            archiveNote.created_at ?? null,
            archiveNote.updated_at ?? null
          );

          const stagedNoteId = Number(noteInsertResult.lastInsertRowid);
          const parsedImages = parseImageRecords(archiveNote.images);
          const { rewritten, copyPlan } = rewriteImageRecordsForImportedNote(
            parsedImages,
            Number(archiveNote.id),
            stagedNoteId,
          );

          updateNoteImagesStatement.run(JSON.stringify(rewritten), stagedNoteId);

          for (const plannedCopy of copyPlan) {
            imageCopyPlan.push(plannedCopy);
          }

          const noteTags = tagsByNoteId.get(Number(archiveNote.id)) ?? [];
          for (const tagName of noteTags) {
            insertTagStatement.run(tagName, stagedCollectionId);
            const tagRow = getTagByNameStatement.get(stagedCollectionId, tagName);
            if (tagRow?.id) {
              insertTagLinkStatement.run(stagedNoteId, Number(tagRow.id));
            }
          }

          nextDisplayOrder += 1;
        }
      }

      if (importedDefaults.length) {
        importedDefaults.sort((a, b) => a.archiveCollectionId - b.archiveCollectionId);
        clearDefaultStatement.run();
        markDefaultStatement.run(importedDefaults[0].stagedCollectionId);
      }
    });

    importTransaction();

    for (const noteId of removedNoteIds) {
      removePathIfExists(path.join(stagedImagesDir, 'notes', String(noteId)));
    }

    for (const plannedCopy of imageCopyPlan) {
      copyReferencedImage(
        archiveImagesDir,
        stagedImagesDir,
        plannedCopy.fromRelativePath,
        plannedCopy.toRelativePath,
      );
    }
  } finally {
    archiveDatabase.close();
    stagedDatabase.close();
  }
}

archiveRouter.get('/export', async (request, response) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-export-'));
  const snapshotDbPath = path.join(tempRoot, 'banknotes.db');

  try {
    await withExclusiveOperation('exporting_archive', null, async () => {
      await backupDatabase(snapshotDbPath);

      const selectedCollectionIds = parseSelectedCollectionIds(request.query.collectionIds);
      const filteredSnapshot = buildFilteredExportSnapshot(snapshotDbPath, selectedCollectionIds, tempRoot);

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

        if (fs.existsSync(filteredSnapshot.imagesDir)) {
          archive.directory(filteredSnapshot.imagesDir, 'images');
        } else {
          archive.append('', { name: 'images/.keep' });
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

      const staged = prepareStagedDataDir(DATA_DIR);
      stageRoot = staged.stageRoot;

      mergeArchiveIntoStagedData(archiveDataDir, staged.stagedDataDir);
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
