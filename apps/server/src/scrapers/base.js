import fs from 'node:fs/promises';
import path from 'node:path';
import { SCRAPED_IMAGES_DIR } from '../db.js';

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

  parse() {
    throw new Error('parse() must be implemented by subclasses');
  }

  async downloadImage(imageUrl, relativePath) {
    if (!imageUrl) {
      return null;
    }

    const targetPath = path.join(SCRAPED_IMAGES_DIR, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
    return `/api/images/scraped/${relativePath.replace(/\\/g, '/')}`;
  }

  getImageFolder(certNumber) {
    return sanitizeSegment(certNumber || this.note.catalog_number || this.note.id);
  }
}

export { BaseScraper, sanitizeSegment };
