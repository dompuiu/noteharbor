import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { importNotes } from '../db.js';
import { withExclusiveOperation } from '../operationState.js';

const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });
const IGNORE_AFTER_MARKER = 'ignore after this line';

function normalizeCell(value) {
  return String(value ?? '').trim();
}

function normalizeHeader(value) {
  return normalizeCell(value).toLowerCase();
}

function splitTags(value) {
  return normalizeCell(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function mapRow(rawRow) {
  return {
    denomination: normalizeCell(rawRow[0]),
    issue_date: normalizeCell(rawRow[1]),
    catalog_number: normalizeCell(rawRow[2]),
    grading_company: normalizeCell(rawRow[3]),
    grade: normalizeCell(rawRow[4]),
    watermark: normalizeCell(rawRow[5]),
    serial: normalizeCell(rawRow[6]),
    url: normalizeCell(rawRow[7]),
    tags: splitTags(rawRow[8]),
    notes: normalizeCell(rawRow[9])
  };
}

function isHeaderRow(rawRow) {
  return normalizeHeader(rawRow[0]) === 'denomination' && normalizeHeader(rawRow[2]) === 'catalog no';
}

function isIgnoreAfterRow(rawRow) {
  return normalizeHeader(rawRow[0]).startsWith(IGNORE_AFTER_MARKER);
}

function isEmptyRow(note) {
  return Object.entries(note)
    .filter(([key]) => key !== 'tags')
    .every(([, value]) => !normalizeCell(value)) && !note.tags.length;
}

function isLikelyBanknote(note) {
  return Boolean(
    note.denomination && (note.catalog_number || note.serial || note.url || note.grading_company || note.grade || note.issue_date)
  );
}

function getCsvSource(request) {
  if (request.file) {
    return request.file.buffer;
  }

  const csvText = normalizeCell(request.body?.csv_text);
  if (csvText) {
    return csvText;
  }

  return null;
}

importRouter.post('/', upload.single('file'), async (request, response) => {
  const source = getCsvSource(request);

  if (!source) {
    response.status(400).json({ error: 'CSV file or pasted CSV text is required.' });
    return;
  }

  try {
    const payload = await withExclusiveOperation('importing_csv', null, async () => {
      const records = parse(source, {
        columns: false,
        bom: true,
        skip_empty_lines: false,
        relax_column_count: true,
        trim: true
      });

      let ignored = 0;
      const notesToImport = [];

      for (let index = 0; index < records.length; index += 1) {
        const rawRow = records[index];

        if (isIgnoreAfterRow(rawRow)) {
          ignored += records.length - index;
          break;
        }

        if (isHeaderRow(rawRow)) {
          continue;
        }

        const note = mapRow(rawRow);

        if (isEmptyRow(note)) {
          ignored += 1;
          continue;
        }

        if (!isLikelyBanknote(note)) {
          ignored += 1;
          continue;
        }

        notesToImport.push(note);
      }

      const { imported, updated, deleted } = importNotes(notesToImport);

      return {
        imported,
        updated,
        deleted,
        ignored,
        total: records.length,
        ordered: notesToImport.length
      };
    });

    response.json(payload);
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message, currentOperation: error.currentOperation });
  }
});

export { importRouter };
