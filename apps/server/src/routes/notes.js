import { Router } from 'express';
import { getAllNotes, getNoteById, updateNote } from '../db.js';

const notesRouter = Router();

notesRouter.get('/', (_request, response) => {
  response.json({ notes: getAllNotes() });
});

notesRouter.get('/:id', (request, response) => {
  const note = getNoteById(Number(request.params.id));

  if (!note) {
    response.status(404).json({ error: 'Note not found.' });
    return;
  }

  response.json({ note });
});

notesRouter.put('/:id', (request, response) => {
  const noteId = Number(request.params.id);
  const existing = getNoteById(noteId);

  if (!existing) {
    response.status(404).json({ error: 'Note not found.' });
    return;
  }

  const payload = {
    id: noteId,
    denomination: String(request.body.denomination ?? '').trim(),
    issue_date: String(request.body.issue_date ?? '').trim(),
    catalog_number: String(request.body.catalog_number ?? '').trim(),
    grading_company: String(request.body.grading_company ?? '').trim(),
    grade: String(request.body.grade ?? '').trim(),
    watermark: String(request.body.watermark ?? '').trim(),
    serial: String(request.body.serial ?? '').trim(),
    url: String(request.body.url ?? '').trim(),
    notes: String(request.body.notes ?? '').trim(),
    tags: Array.isArray(request.body.tags) ? request.body.tags : []
  };

  try {
    const updated = updateNote(payload);
    response.json({ note: updated });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

export { notesRouter };
