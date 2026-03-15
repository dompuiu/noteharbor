import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { importNotes, seedTagSuggestions } from '../db.js';

const importRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function mapRow(rawRow) {
  return {
    denomination: String(rawRow[0] ?? '').trim(),
    issue_date: String(rawRow[1] ?? '').trim(),
    catalog_number: String(rawRow[2] ?? '').trim(),
    grading_company: String(rawRow[3] ?? '').trim(),
    grade: String(rawRow[4] ?? '').trim(),
    watermark: String(rawRow[5] ?? '').trim(),
    serial: String(rawRow[6] ?? '').trim(),
    url: String(rawRow[7] ?? '').trim(),
    notes: String(rawRow[8] ?? '').trim()
  };
}

function isHeaderRow(rawRow) {
  return String(rawRow[0] ?? '').trim() === 'Denominatia' && String(rawRow[2] ?? '').trim() === 'Numar catalog';
}

function isEmptyRow(note) {
  return Object.values(note).every((value) => !String(value ?? '').trim());
}

function isLikelyBanknote(note) {
  return Boolean(
    note.denomination && (note.catalog_number || note.serial || note.url || note.grading_company || note.grade || note.issue_date)
  );
}

importRouter.post('/', upload.single('file'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ error: 'CSV file is required.' });
    return;
  }

  const records = parse(request.file.buffer, {
    columns: false,
    bom: true,
    skip_empty_lines: false,
    relax_column_count: true,
    trim: true
  });

  let ignored = 0;
  const tagSuggestions = [];
  const notesToImport = [];

  for (const rawRow of records) {
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

    if (note.notes) {
      tagSuggestions.push(note.notes);
    }

    notesToImport.push(note);
  }

  const { imported, skipped } = importNotes(notesToImport);
  seedTagSuggestions(tagSuggestions);

  response.json({
    imported,
    skipped,
    ignored,
    total: records.length,
    ordered: notesToImport.length
  });
});

export { importRouter };
