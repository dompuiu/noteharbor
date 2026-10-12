import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SLOTS, IMAGE_VARIANTS, generateThumbnailBuffer, normalizeImages } from './imageStore.js';

test('full and thumbnail image slots are defined', () => {
  assert.deepEqual(IMAGE_VARIANTS, ['full', 'thumbnail']);
  assert.deepEqual(
    IMAGE_SLOTS.map((slot) => slot.field).sort(),
    ['image_back_full', 'image_back_thumbnail', 'image_front_full', 'image_front_thumbnail']
  );
});

test('normalizeImages keeps thumbnail records', () => {
  const normalized = normalizeImages([
    { type: 'front', variant: 'full', localPath: '/api/images/notes/1/front-full.jpg', origin: 'scraped' },
    { type: 'front', variant: 'thumbnail', localPath: '/api/images/notes/1/front-thumbnail.jpg', origin: 'scraped' },
    { type: 'back', variant: 'full', localPath: '/api/images/notes/1/back-full.jpg', origin: 'uploaded' },
    { type: 'back', variant: 'thumbnail', localPath: '/api/images/notes/1/back-thumbnail.jpg', origin: 'generated' }
  ]);

  assert.deepEqual(
    normalized.map((image) => `${image.type}:${image.variant}`),
    ['front:full', 'front:thumbnail', 'back:full', 'back:thumbnail']
  );
});

test('normalizeImages drops malformed records', () => {
  assert.deepEqual(normalizeImages([
    { type: 'front', variant: 'full', localPath: null },
    { variant: 'full', localPath: '/api/images/notes/1/front-full.jpg' },
    { type: 'front', variant: 'preview', localPath: '/api/images/notes/1/front-preview.jpg' }
  ]), []);
});

test('generateThumbnailBuffer produces a smaller image', async () => {
  const { default: sharp } = await import('sharp');
  const input = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 100, b: 50 } }
  }).jpeg().toBuffer();
  const thumb = await generateThumbnailBuffer(input);
  const metadata = await sharp(thumb).metadata();
  assert.ok(metadata.width <= 500);
  assert.ok(thumb.length < input.length);
});
