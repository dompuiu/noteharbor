import * as cheerio from 'cheerio';
import { BaseScraper } from './base.js';

function normalizeLabel(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function unescapeHtmlString(value) {
  return String(value ?? '')
    .replace(/\\\//g, '/')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readStringLiteral(source, key) {
  const match = source.match(new RegExp(`${escapeRegex(key)}:\"([^\"]*)\"`));
  return match ? unescapeHtmlString(match[1]) : null;
}

function readNumberLiteral(source, key) {
  const match = source.match(new RegExp(`${escapeRegex(key)}:([0-9]+)`));
  return match ? Number(match[1]) : null;
}

function readBooleanLiteral(source, key) {
  const match = source.match(new RegExp(`${escapeRegex(key)}:(true|false)`));
  return match ? match[1] === 'true' : null;
}

function extractEmbeddedDataSource(html) {
  const match = html.match(/const data = \[(.*?)\];\s*Promise\.all\(/s);
  return match ? match[1] : '';
}

function extractEmbeddedImages(source) {
  const images = [];
  const imagePattern = /\{showThumbnail:(?:true|false),label:\"([^\"]+)\",downloadUrl:\"([^\"]+)\",thumbnailUrl:\"([^\"]+)\",popupUrl:\"([^\"]+)\"[^{}]*\}/g;

  for (const match of source.matchAll(imagePattern)) {
    const [, label, downloadUrl, thumbnailUrl, popupUrl] = match;
    const normalizedLabel = label.toLowerCase();
    const side = normalizedLabel.includes('reverse') ? 'back' : 'front';

    if (popupUrl || downloadUrl) {
      images.push({
        side,
        variant: 'full',
        url: unescapeHtmlString(popupUrl || downloadUrl)
      });
    }

    if (thumbnailUrl) {
      images.push({
        side,
        variant: 'thumbnail',
        url: unescapeHtmlString(thumbnailUrl)
      });
    }
  }

  return images;
}

function extractTableDetails($) {
  const details = {};

  $('table tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 2) {
      return;
    }

    const label = $(cells[0]).text().trim().replace(/:$/, '');
    const value = $(cells[1]).text().trim();

    if (label && value) {
      details[normalizeLabel(label)] = value;
    }
  });

  return details;
}

function normalizeGrade(displayGrade, gradeDesc, opq) {
  const normalizedDisplayGrade = String(displayGrade ?? '').trim();
  if (!normalizedDisplayGrade) {
    const normalizedGradeDesc = String(gradeDesc ?? '').trim();
    if (!normalizedGradeDesc) {
      return null;
    }

    const parsedNumericGrade = normalizedGradeDesc.match(/\b(\d{1,3})\b/)?.[1] ?? null;
    if (!parsedNumericGrade) {
      return normalizedGradeDesc;
    }

    return [parsedNumericGrade, opq ? 'PPQ' : null].filter(Boolean).join(' ');
  }

  return [normalizedDisplayGrade, opq ? 'PPQ' : null].filter(Boolean).join(' ');
}

class PCGSScraper extends BaseScraper {
  getWaitForSelector() {
    return 'table';
  }

  parse(html, pageUrl) {
    const $ = cheerio.load(html);
    const embeddedData = extractEmbeddedDataSource(html);
    const tableDetails = extractTableDetails($);
    const opq = readBooleanLiteral(embeddedData, 'opq');
    const displayGrade = readStringLiteral(embeddedData, 'displayGrade');
    const gradeDesc = readStringLiteral(embeddedData, 'gradeDesc') || tableDetails.grade || null;
    const banknoteDetails = readStringLiteral(embeddedData, 'banknoteDetails') || tableDetails.details || null;
    const certNumber =
      readStringLiteral(embeddedData, 'certNo') ||
      tableDetails.cert ||
      this.note.catalog_number ||
      String(this.note.id);

    const details = {
      cert_no: readStringLiteral(embeddedData, 'certNo') || certNumber,
      spec_no: readStringLiteral(embeddedData, 'specNo'),
      display_note_no: readStringLiteral(embeddedData, 'displayNoteNo') || readStringLiteral(embeddedData, 'pcgsDisplayNo'),
      serial_number: readStringLiteral(embeddedData, 'currencySerialNumber') || tableDetails.serial_number || null,
      date: readStringLiteral(embeddedData, 'currencyDate') || readStringLiteral(embeddedData, 'dateMintmark') || tableDetails.date || null,
      denomination: readStringLiteral(embeddedData, 'denomination') || tableDetails.denomination || null,
      catalog_label: readStringLiteral(embeddedData, 'catalog1LongDesc') || 'Catalog',
      catalog_number: readStringLiteral(embeddedData, 'catalogNo1') || tableDetails.catalog || null,
      country: readStringLiteral(embeddedData, 'country') || tableDetails.region || null,
      region: tableDetails.region || readStringLiteral(embeddedData, 'countryCode') || null,
      display_grade: displayGrade,
      grade_desc: gradeDesc,
      grade: normalizeGrade(displayGrade, gradeDesc, opq),
      details: banknoteDetails,
      banknote_details: banknoteDetails,
      security: tableDetails.security || null,
      population:
        readNumberLiteral(embeddedData, 'population') ??
        (Number(tableDetails.population || '') || null),
      pop_higher:
        readNumberLiteral(embeddedData, 'popHigher') ??
        (Number(tableDetails.pop_higher || '') || null),
      opq,
      nfc_secure: readBooleanLiteral(embeddedData, 'isNFCSecure'),
      source_url: pageUrl
    };

    return {
      certNumber,
      details,
      images: extractEmbeddedImages(embeddedData)
    };
  }

  async downloadImages(parsedResult) {
    const savedImages = [];

    for (const image of parsedResult.images) {
      const savedImage = await this.downloadImage(image.url, image.side, image.variant);
      if (savedImage) {
        savedImages.push(savedImage);
      }
    }

    return savedImages;
  }
}

export { PCGSScraper };
