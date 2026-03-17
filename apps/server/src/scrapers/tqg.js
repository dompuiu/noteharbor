import * as cheerio from 'cheerio';
import { BaseScraper } from './base.js';

function getQueryFolderName(pageUrl) {
  try {
    const { pathname } = new URL(pageUrl);
    const match = pathname.match(/\/query\/([^/]+)$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function getCellText($, cell) {
  const clone = $(cell).clone();
  clone.find('span').remove();
  return clone.text().trim().replace(/:$/, '');
}

class TQGScraper extends BaseScraper {
  getWaitForSelector() {
    return '.query_wrap';
  }

  parse(html, pageUrl) {
    const $ = cheerio.load(html);
    const details = {};

    $('.query_wrap table tr').each((_, element) => {
      const cells = $(element).find('td');

      if (cells.length < 2) {
        return;
      }

      const label = getCellText($, cells[0]);
      const value = $(cells[1]).text().trim();

      if (label && value) {
        details[normalizeLabel(label)] = value;
      }
    });

    const images = [];

    $('.query_wrap .thumbs img').each((index, element) => {
      const src = $(element).attr('src');

      if (!src) {
        return;
      }

      const side = index === 0 ? 'front' : index === 1 ? 'back' : `image_${index + 1}`;
      images.push({
        side,
        variant: 'full',
        url: new URL(src, pageUrl).href
      });
    });

    const certNumber = getQueryFolderName(pageUrl)
      || this.note.serial
      || this.note.catalog_number
      || String(this.note.id);

    return {
      certNumber,
      details: {
        ...details,
        source_url: pageUrl
      },
      images
    };
  }

  async downloadImages(parsedResult) {
    const folder = this.getImageFolder(parsedResult.certNumber);
    const savedImages = [];

    for (const image of parsedResult.images) {
      const localPath = await this.downloadImage(image.url, `${folder}/${image.side}.jpg`);
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

export { TQGScraper };
