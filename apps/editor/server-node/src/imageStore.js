import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_TYPES = ['front', 'back'];
const IMAGE_VARIANTS = ['full', 'thumbnail'];
const IMAGE_SLOTS = [
  { field: 'image_front_full', type: 'front', variant: 'full' },
  { field: 'image_front_thumbnail', type: 'front', variant: 'thumbnail' },
  { field: 'image_back_full', type: 'back', variant: 'full' },
  { field: 'image_back_thumbnail', type: 'back', variant: 'thumbnail' }
];
const IMAGE_ORIGINS = {
  scraped: 'scraped',
  uploaded: 'uploaded',
  generated: 'generated'
};
const SLOT_KEY_SEPARATOR = ':';
const THUMBNAIL_MAX_WIDTH = 500;

function imageSlotKey(type, variant) {
  return `${type}${SLOT_KEY_SEPARATOR}${variant}`;
}

function fieldNameForSlot(type, variant) {
  return `image_${type}_${variant}`;
}

function deleteFlagFieldName(type, variant) {
  return `delete_image_${type}_${variant}`;
}

function generateFlagFieldName(type) {
  return `generate_image_${type}_thumbnail_from_full`;
}

function parseBooleanFlag(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getExtensionForMimeType(mimeType, originalName = '') {
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

  const parsedExtension = path.extname(originalName).toLowerCase();
  return parsedExtension || '.jpg';
}

function getNoteImagesDir(imagesDir, noteId) {
  return path.join(imagesDir, 'notes', String(noteId));
}

function getSlotBasename(type, variant) {
  return `${type}-${variant}`;
}

function buildLocalPath(noteId, type, variant, extension) {
  return `/api/images/notes/${noteId}/${getSlotBasename(type, variant)}${extension}`;
}

function resolveLocalPath(imagesDir, localPath) {
  if (typeof localPath !== 'string' || !localPath.startsWith('/api/images/')) {
    return null;
  }

  return path.join(imagesDir, localPath.replace('/api/images/', ''));
}

function listSlotFiles(noteImagesDir, type, variant) {
  if (!fs.existsSync(noteImagesDir)) {
    return [];
  }

  const baseName = `${getSlotBasename(type, variant)}.`;
  return fs
    .readdirSync(noteImagesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(baseName))
    .map((entry) => path.join(noteImagesDir, entry.name));
}

function deleteSlotFiles(imagesDir, noteId, type, variant) {
  const noteImagesDir = getNoteImagesDir(imagesDir, noteId);
  for (const filePath of listSlotFiles(noteImagesDir, type, variant)) {
    fs.rmSync(filePath, { force: true });
  }
}

function removeFileIfManaged(imagesDir, image) {
  const filePath = resolveLocalPath(imagesDir, image?.localPath);
  if (filePath && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function ensureNoteImagesDir(imagesDir, noteId) {
  const noteImagesDir = getNoteImagesDir(imagesDir, noteId);
  fs.mkdirSync(noteImagesDir, { recursive: true });
  return noteImagesDir;
}

function normalizeImageOrigin(image) {
  const normalized = String(image?.origin ?? '').trim().toLowerCase();
  if (normalized === IMAGE_ORIGINS.scraped || normalized === IMAGE_ORIGINS.uploaded || normalized === IMAGE_ORIGINS.generated) {
    return normalized;
  }

  const localPath = String(image?.localPath ?? '');
  if (localPath.startsWith('/api/images/scraped/')) {
    return IMAGE_ORIGINS.scraped;
  }

  if (localPath.startsWith('/api/images/notes/')) {
    return IMAGE_ORIGINS.uploaded;
  }

  return IMAGE_ORIGINS.uploaded;
}

function normalizeImageRecord(image) {
  if (!image?.type || !image?.variant || !image?.localPath) {
    return null;
  }

  return {
    type: image.type,
    variant: image.variant,
    localPath: image.localPath,
    sourceUrl: image.sourceUrl ?? null,
    origin: normalizeImageOrigin(image)
  };
}

function normalizeImages(images) {
  const bySlot = new Map();

  for (const image of images ?? []) {
    const normalized = normalizeImageRecord(image);
    if (!normalized) {
      continue;
    }

    bySlot.set(imageSlotKey(normalized.type, normalized.variant), normalized);
  }

  return IMAGE_SLOTS
    .map((slot) => bySlot.get(imageSlotKey(slot.type, slot.variant)))
    .filter(Boolean);
}

function imageMapFromList(images) {
  return new Map(normalizeImages(images).map((image) => [imageSlotKey(image.type, image.variant), image]));
}

function slotRecord(noteId, type, variant, extension, origin, sourceUrl = null) {
  return {
    type,
    variant,
    localPath: buildLocalPath(noteId, type, variant, extension),
    sourceUrl,
    origin
  };
}

function writeSlotBuffer(imagesDir, noteId, type, variant, buffer, { extension, origin, sourceUrl = null } = {}) {
  const noteImagesDir = ensureNoteImagesDir(imagesDir, noteId);
  const normalizedExtension = extension?.startsWith('.') ? extension.toLowerCase() : `.${String(extension ?? 'jpg').toLowerCase()}`;
  deleteSlotFiles(imagesDir, noteId, type, variant);
  const targetPath = path.join(noteImagesDir, `${getSlotBasename(type, variant)}${normalizedExtension}`);
  fs.writeFileSync(targetPath, buffer);
  return slotRecord(noteId, type, variant, normalizedExtension, origin, sourceUrl);
}

async function generateThumbnailBuffer(inputBuffer) {
  return sharp(inputBuffer)
    .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
    .toBuffer();
}

function removeStaleManagedFiles(imagesDir, noteId, images) {
  const noteImagesDir = getNoteImagesDir(imagesDir, noteId);
  if (!fs.existsSync(noteImagesDir)) {
    return;
  }

  const keepNames = new Set(
    normalizeImages(images)
      .map((image) => resolveLocalPath(imagesDir, image.localPath))
      .filter(Boolean)
  );

  for (const entry of fs.readdirSync(noteImagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(noteImagesDir, entry.name);
    if (!keepNames.has(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }

  if (!fs.readdirSync(noteImagesDir).length) {
    fs.rmSync(noteImagesDir, { recursive: true, force: true });
  }
}

export {
  IMAGE_ORIGINS,
  IMAGE_SLOTS,
  IMAGE_TYPES,
  IMAGE_VARIANTS,
  THUMBNAIL_MAX_WIDTH,
  buildLocalPath,
  deleteFlagFieldName,
  deleteSlotFiles,
  ensureNoteImagesDir,
  fieldNameForSlot,
  generateFlagFieldName,
  generateThumbnailBuffer,
  getExtensionForMimeType,
  getNoteImagesDir,
  imageMapFromList,
  imageSlotKey,
  listSlotFiles,
  normalizeImageOrigin,
  normalizeImageRecord,
  normalizeImages,
  parseBooleanFlag,
  removeFileIfManaged,
  removeStaleManagedFiles,
  resolveLocalPath,
  slotRecord,
  writeSlotBuffer
};
