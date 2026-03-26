import fs from 'node:fs';
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
import {
  IMAGE_ORIGINS,
  IMAGE_SLOTS,
  deleteFlagFieldName,
  fieldNameForSlot,
  generateFlagFieldName,
  generateThumbnailBuffer,
  getExtensionForMimeType,
  imageMapFromList,
  imageSlotKey,
  normalizeImages,
  parseBooleanFlag,
  removeFileIfManaged,
  resolveLocalPath,
  writeSlotBuffer
} from '../imageStore.js';

const notesRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024
  }
});
const uploadFields = upload.fields(IMAGE_SLOTS.map((slot) => ({ name: slot.field, maxCount: 1 })));

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return [value];
  }

  return [];
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

function getUploadedFile(filesByField, type, variant) {
  return filesByField?.[fieldNameForSlot(type, variant)]?.[0] ?? null;
}

function shouldDeleteSlot(body, type, variant) {
  return parseBooleanFlag(body?.[deleteFlagFieldName(type, variant)]);
}

function shouldGenerateThumbnail(body, type) {
  return parseBooleanFlag(body?.[generateFlagFieldName(type)]);
}

function removeImageFromMap(imagesBySlot, slot) {
  const key = imageSlotKey(slot.type, slot.variant);
  const existing = imagesBySlot.get(key);
  if (existing) {
    removeFileIfManaged(IMAGES_DIR, existing);
    imagesBySlot.delete(key);
  }
}

function getExistingImageBuffer(image) {
  const filePath = resolveLocalPath(IMAGES_DIR, image?.localPath);
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath);
}

async function buildNextImages(noteId, existingImages, body, filesByField) {
  const imagesBySlot = imageMapFromList(existingImages);

  for (const slot of IMAGE_SLOTS) {
    if (shouldDeleteSlot(body, slot.type, slot.variant)) {
      removeImageFromMap(imagesBySlot, slot);
    }
  }

  for (const slot of IMAGE_SLOTS) {
    const file = getUploadedFile(filesByField, slot.type, slot.variant);

    if (!file || !String(file.mimetype ?? '').startsWith('image/')) {
      continue;
    }

    removeImageFromMap(imagesBySlot, slot);
    const extension = getExtensionForMimeType(file.mimetype, file.originalname);
    const nextImage = writeSlotBuffer(IMAGES_DIR, noteId, slot.type, slot.variant, file.buffer, {
      extension,
      origin: IMAGE_ORIGINS.uploaded,
      sourceUrl: null
    });
    imagesBySlot.set(imageSlotKey(slot.type, slot.variant), nextImage);
  }

  for (const type of ['front', 'back']) {
    const fullFile = getUploadedFile(filesByField, type, 'full');
    const thumbnailFile = getUploadedFile(filesByField, type, 'thumbnail');
    const existingFullImage = imagesBySlot.get(imageSlotKey(type, 'full'));

    if (thumbnailFile || !shouldGenerateThumbnail(body, type)) {
      continue;
    }

    const sourceBuffer = fullFile?.buffer ?? getExistingImageBuffer(existingFullImage);
    if (!sourceBuffer) {
      continue;
    }

    const generatedBuffer = await generateThumbnailBuffer(sourceBuffer);
    removeImageFromMap(imagesBySlot, { type, variant: 'thumbnail' });
    const extension = fullFile
      ? getExtensionForMimeType(fullFile.mimetype, fullFile.originalname)
      : getExtensionForMimeType(null, existingFullImage?.localPath);
    const generatedImage = writeSlotBuffer(IMAGES_DIR, noteId, type, 'thumbnail', generatedBuffer, {
      extension,
      origin: IMAGE_ORIGINS.generated,
      sourceUrl: null
    });
    imagesBySlot.set(imageSlotKey(type, 'thumbnail'), generatedImage);
  }

  return normalizeImages(Array.from(imagesBySlot.values()));
}

notesRouter.get('/', (_request, response) => {
  response.json({ notes: getAllNotes() });
});

notesRouter.post('/', uploadFields, async (request, response) => {
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

    const nextImages = await buildNextImages(note.id, [], request.body, request.files);
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

notesRouter.put('/:id', uploadFields, async (request, response) => {
  const noteId = Number(request.params.id);
  const existing = getNoteById(noteId);

  if (!existing) {
    response.status(404).json({ error: 'Note not found.' });
    return;
  }

  try {
    const payload = {
      id: noteId,
      ...sanitizeNotePayload(request.body),
      images: await buildNextImages(noteId, existing.images, request.body, request.files)
    };

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
