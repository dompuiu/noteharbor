import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import {
  createNote,
  deleteNote,
  getAllNotes,
  getNoteById,
  IMAGES_DIR,
  reorderNotes,
  updateNote
} from '../db.js';
import { rejectReadOnly, shouldUseReadOnlyMode } from '../serverMode.js';

const notesRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});
const imageSlots = [
  { field: 'image_front_full', type: 'front', variant: 'full' },
  { field: 'image_front_thumbnail', type: 'front', variant: 'thumbnail' },
  { field: 'image_back_full', type: 'back', variant: 'full' },
  { field: 'image_back_thumbnail', type: 'back', variant: 'thumbnail' }
];
const slotFieldMap = new Map(imageSlots.map((slot) => [slot.field, slot]));
const uploadFields = upload.fields(imageSlots.map((slot) => ({ name: slot.field, maxCount: 1 })));

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return [value];
  }

  return [];
}

function getExtensionForMimeType(mimeType, originalName) {
  if (mimeType === 'image/png') {
    return '.png';
  }

  if (mimeType === 'image/webp') {
    return '.webp';
  }

  if (mimeType === 'image/gif') {
    return '.gif';
  }

  if (mimeType === 'image/jpeg') {
    return '.jpg';
  }

  const parsedExtension = path.extname(originalName || '').toLowerCase();
  return parsedExtension || '.jpg';
}

function isManagedNoteImage(noteId, image) {
  return typeof image?.localPath === 'string' && image.localPath.startsWith(`/api/images/notes/${noteId}/`);
}

function removeManagedImageFile(noteId, image) {
  if (!isManagedNoteImage(noteId, image)) {
    return;
  }

  const relativePath = image.localPath.replace('/api/images/', '');
  const filePath = path.join(IMAGES_DIR, relativePath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function saveUploadedImages(noteId, existingImages, filesByField) {
  const noteImagesDir = path.join(IMAGES_DIR, 'notes', String(noteId));
  fs.mkdirSync(noteImagesDir, { recursive: true });

  const mergedImages = new Map();
  for (const image of existingImages ?? []) {
    if (image?.type && image?.variant) {
      mergedImages.set(`${image.type}:${image.variant}`, image);
    }
  }

  for (const [fieldName, files] of Object.entries(filesByField ?? {})) {
    const slot = slotFieldMap.get(fieldName);
    const file = files?.[0];

    if (!slot || !file || !String(file.mimetype ?? '').startsWith('image/')) {
      continue;
    }

    const key = `${slot.type}:${slot.variant}`;
    removeManagedImageFile(noteId, mergedImages.get(key));

    const extension = getExtensionForMimeType(file.mimetype, file.originalname);
    const filename = `${slot.type}-${slot.variant}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`;
    const targetPath = path.join(noteImagesDir, filename);
    fs.writeFileSync(targetPath, file.buffer);

    mergedImages.set(key, {
      type: slot.type,
      variant: slot.variant,
      localPath: `/api/images/notes/${noteId}/${filename}`,
      sourceUrl: null
    });
  }

  return imageSlots
    .map((slot) => mergedImages.get(`${slot.type}:${slot.variant}`))
    .filter(Boolean);
}

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
    tags: normalizeTags(body.tags)
  };
}

notesRouter.get('/', (_request, response) => {
  response.json({ notes: getAllNotes() });
});

notesRouter.post('/', uploadFields, (request, response) => {
  if (shouldUseReadOnlyMode()) {
    rejectReadOnly(response);
    return;
  }

  const payload = sanitizeNotePayload(request.body);

  if (!payload.denomination) {
    response.status(400).json({ error: 'Denomination is required.' });
    return;
  }

  try {
    let note = createNote({
      ...payload,
      images: []
    });

    const nextImages = saveUploadedImages(note.id, [], request.files);
    if (nextImages.length) {
      note = updateNote({
        id: note.id,
        ...payload,
        images: nextImages
      });
    }

    response.status(201).json({ note });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

notesRouter.post('/reorder', (request, response) => {
  if (shouldUseReadOnlyMode()) {
    rejectReadOnly(response);
    return;
  }

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

notesRouter.put('/:id', uploadFields, (request, response) => {
  if (shouldUseReadOnlyMode()) {
    rejectReadOnly(response);
    return;
  }

  const noteId = Number(request.params.id);
  const existing = getNoteById(noteId);

  if (!existing) {
    response.status(404).json({ error: 'Note not found.' });
    return;
  }

  const payload = {
    id: noteId,
    ...sanitizeNotePayload(request.body),
    images: saveUploadedImages(noteId, existing.images, request.files)
  };

  try {
    const updated = updateNote(payload);
    response.json({ note: updated });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

notesRouter.delete('/:id', (request, response) => {
  if (shouldUseReadOnlyMode()) {
    rejectReadOnly(response);
    return;
  }

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
