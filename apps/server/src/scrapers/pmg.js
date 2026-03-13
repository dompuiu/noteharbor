import * as cheerio from 'cheerio';
import { BaseScraper } from './base.js';

function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

class PMGScraper extends BaseScraper {
  parse(html, pageUrl) {
    const $ = cheerio.load(html);
    const details = {};

    $('.certlookup-results-data dl').each((_, element) => {
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
      const side = title.includes('rev') || title.includes('back') || title.includes('reverse') ? 'back' : 'front';
      const fullSizeUrl = anchor.attr('href') ? new URL(anchor.attr('href'), pageUrl).href : null;
      const thumbnailUrl = img.attr('src') ? new URL(img.attr('src'), pageUrl).href : null;

      if (fullSizeUrl || thumbnailUrl) {
        images.push({
          side,
          fullSizeUrl,
          thumbnailUrl
        });
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
      if (image.fullSizeUrl) {
        const localPath = await this.downloadImage(image.fullSizeUrl, `${folder}/${image.side}.jpg`);
        savedImages.push({
          type: image.side,
          variant: 'full',
          localPath,
          sourceUrl: image.fullSizeUrl
        });
      }

      if (image.thumbnailUrl) {
        const localPath = await this.downloadImage(image.thumbnailUrl, `${folder}/${image.side}_thumb.jpg`);
        savedImages.push({
          type: image.side,
          variant: 'thumbnail',
          localPath,
          sourceUrl: image.thumbnailUrl
        });
      }
    }

    return savedImages;
  }
}

export { PMGScraper };
