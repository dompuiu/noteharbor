import { Router } from 'express';
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
  reorderNotes,
  updateNote
} from '../db.js';

const notesRouter = Router();

function sanitizeNotePayload(body) {
  return {
    denomination: String(body.denomination ?? '').trim(),
    issue_date: String(body.issue_date ?? '').trim(),
    catalog_number: String(body.catalog_number ?? '').trim(),
    grading_company: String(body.grading_company ?? '').trim(),
    grade: String(body.grade ?? '').trim(),
    watermark: String(body.watermark ?? '').trim(),
    serial: String(body.serial ?? '').trim(),
    url: String(body.url ?? '').trim(),
    notes: String(body.notes ?? '').trim(),
    tags: Array.isArray(body.tags) ? body.tags : []
  };
}

notesRouter.get('/', (_request, response) => {
  response.json({ notes: getAllNotes() });
});

notesRouter.post('/', (request, response) => {
  const payload = sanitizeNotePayload(request.body);

  if (!payload.denomination) {
    response.status(400).json({ error: 'Denomination is required.' });
    return;
  }

  try {
    const note = createNote(payload);
    response.status(201).json({ note });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
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
    ...sanitizeNotePayload(request.body)
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
