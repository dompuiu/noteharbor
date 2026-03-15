import * as cheerio from 'cheerio';
import { BaseScraper } from './base.js';

function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

class PMGScraper extends BaseScraper {
  getWaitForSelector() {
    return '.certlookup-details';
  }

  parse(html, pageUrl) {
    const $ = cheerio.load(html);
    const details = {};

    $('.certlookup-wrapper dl').each((_, element) => {
      const label = $(element).find('dt').text().trim().replace(/:$/, '');
      const value = $(element).find('dd').text().trim();

      if (label && value) {
        details[normalizeLabel(label)] = value;
      }
    });

    const certNumber = details.pmg_cert || details.cert || this.note.catalog_number || String(this.note.id);
    const images = [];

    $('.certlookup-images-item').each((_, element) => {
      const anchor = $(element).find('a').first();
      const img = $(element).find('img').first();
      const title = (img.attr('title') || '').toLowerCase();
      const side = title.includes('rev') || title.includes('back') || title.includes('reverse') ? 'front' : 'back';
      const fullSizeUrl = anchor.attr('href') ? new URL(anchor.attr('href'), pageUrl).href : null;
      const thumbnailUrl = img.attr('src') ? new URL(img.attr('src'), pageUrl).href : null;

      if (fullSizeUrl) {
        images.push({ side, variant: 'full', url: fullSizeUrl });
      }

      if (thumbnailUrl) {
        images.push({ side, variant: 'thumbnail', url: thumbnailUrl });
      }
    });

    const comments = $('.certlookup-disclaimer').text().trim();

    return {
      certNumber,
      details: {
        ...details,
        source_url: pageUrl,
        page_comments: comments || null
      },
      images
    };
  }

  async downloadImages(parsedResult) {
    const folder = this.getImageFolder(parsedResult.certNumber);
    const savedImages = [];

    for (const image of parsedResult.images) {
      const filename = image.variant === 'thumbnail'
        ? `${image.side}_thumb.jpg`
        : `${image.side}.jpg`;

      const localPath = await this.downloadImage(image.url, `${folder}/${filename}`);
      savedImages.push({
        type: image.side,
        variant: image.variant,
        localPath,
        sourceUrl: image.url
      });
    }

    return savedImages;
  }
}

export { PMGScraper };
