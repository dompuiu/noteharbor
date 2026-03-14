import { Router } from 'express';
import {
  deleteNote,
  getAllNotes,
  getNoteById,
  reorderNotes,
  updateNote
} from '../db.js';

const notesRouter = Router();

notesRouter.get('/', (_request, response) => {
  response.json({ notes: getAllNotes() });
});

notesRouter.post('/reorder', (request, response) => {
  const ids = Array.isArray(request.body.ids) ? request.body.ids : null;

  if (!ids) {
    response.status(400).json({ error: 'A full ordered list of note IDs is required.' });
    return;
  }

  try {
    const notes = reorderNotes(ids);
    response.json({ notes });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
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

notesRouter.delete('/:id', (request, response) => {
  const noteId = Number(request.params.id);
  const existing = getNoteById(noteId);

  if (!existing) {
    response.status(404).json({ error: 'Note not found.' });
    return;
  }

  deleteNote(noteId);
  response.json({ success: true });
});

export { notesRouter };
