import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SLOTS, IMAGE_VARIANTS, normalizeImages } from './imageStore.js';

test('only full image slots are defined', () => {
  assert.deepEqual(IMAGE_VARIANTS, ['full']);
  assert.deepEqual(
    IMAGE_SLOTS.map((slot) => slot.field).sort(),
    ['image_back_full', 'image_front_full']
  );
});

test('normalizeImages drops thumbnail records', () => {
  const normalized = normalizeImages([
    { type: 'front', variant: 'full', localPath: '/api/images/notes/1/front-full.jpg', origin: 'scraped' },
    { type: 'front', variant: 'thumbnail', localPath: '/api/images/notes/1/front-thumbnail.jpg', origin: 'scraped' },
    { type: 'back', variant: 'full', localPath: '/api/images/notes/1/back-full.jpg', origin: 'uploaded' },
    { type: 'back', variant: 'thumbnail', localPath: '/api/images/notes/1/back-thumbnail.jpg', origin: 'generated' }
  ]);

  assert.deepEqual(
    normalized.map((image) => `${image.type}:${image.variant}`),
    ['front:full', 'back:full']
  );
});

test('normalizeImages drops malformed records', () => {
  assert.deepEqual(normalizeImages([
    { type: 'front', variant: 'full', localPath: null },
    { variant: 'full', localPath: '/api/images/notes/1/front-full.jpg' },
    { type: 'front', variant: 'preview', localPath: '/api/images/notes/1/front-preview.jpg' }
  ]), []);
});
