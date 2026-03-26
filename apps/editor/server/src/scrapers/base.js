import { IMAGES_DIR } from '../db.js';
import { IMAGE_ORIGINS, getExtensionForMimeType, writeSlotBuffer } from '../imageStore.js';

function sanitizeSegment(value) {
  return String(value ?? 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'unknown';
}

class BaseScraper {
  constructor(note) {
    this.note = note;
  }

  getWaitForSelector() {
    return null;
  }

  parse() {
    throw new Error('parse() must be implemented by subclasses');
  }

  async downloadImage(imageUrl, type, variant) {
    if (!imageUrl) {
      return null;
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const extension = getExtensionForMimeType(response.headers.get('content-type'), new URL(imageUrl).pathname);

    return writeSlotBuffer(IMAGES_DIR, this.note.id, type, variant, Buffer.from(arrayBuffer), {
      extension,
      origin: IMAGE_ORIGINS.scraped,
      sourceUrl: imageUrl
    });
  }

  getImageFolder(certNumber) {
    return sanitizeSegment(certNumber || this.note.catalog_number || this.note.id);
  }
}

export { BaseScraper, sanitizeSegment };
