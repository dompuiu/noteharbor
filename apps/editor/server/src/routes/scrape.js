import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import { getNotesByIds, updateScrapeResult } from '../db.js';
import { beginOperation, createOperationConflictError, endOperation, getOperationStatus } from '../operationState.js';
import { PMGScraper } from '../scrapers/pmg.js';
import { TQGScraper } from '../scrapers/tqg.js';
import { rejectScrapingDisabled, shouldDisableScraping } from '../serverMode.js';

const scrapeRouter = Router();
const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const FETCH_SCRIPT = path.resolve(ROUTES_DIR, '../../fetch_html.py');
const DEFAULT_PMG_PROFILE_DIR = path.resolve(ROUTES_DIR, '../../storage/browser_profiles/pmg');
const DEFAULT_WAIT_SECONDS = 10;

const scrapeState = {
  status: 'idle',
  total: 0,
  completed: 0,
  currentNoteId: null,
  items: [],
  startedAt: null,
  finishedAt: null,
  error: null
};

function getProfileDir() {
  return process.env.PMG_BROWSER_PROFILE_DIR || DEFAULT_PMG_PROFILE_DIR;
}

function setIdleState() {
  scrapeState.status = 'idle';
  scrapeState.total = 0;
  scrapeState.completed = 0;
  scrapeState.currentNoteId = null;
  scrapeState.items = [];
  scrapeState.startedAt = null;
  scrapeState.finishedAt = null;
  scrapeState.error = null;
}

/**
 * Returns the appropriate scraper instance for a note, or null if unsupported.
 * Add new scrapers here as you support more grading companies / sites.
 */
function getScraperForNote(note) {
  const url = note.url?.toLowerCase() ?? '';
  const company = note.grading_company?.toLowerCase() ?? '';

  if (url.includes('pmgnotes.com') || company.includes('pmg')) {
    return new PMGScraper(note);
  }

  if (url.includes('tqggrading.com') || company.includes('tqg')) {
    return new TQGScraper(note);
  }

  return null;
}

/**
 * Spawns fetch_html.py to open the page with crawl4ai and return the raw HTML.
 * The browser runs headless=False so the user can interact with bot challenges.
 */
function fetchHtml(url, waitForSelector) {
  return new Promise((resolve, reject) => {
    const args = [
      FETCH_SCRIPT,
      url,
      '--wait', String(DEFAULT_WAIT_SECONDS),
      '--profile-dir', getProfileDir()
    ];

    if (waitForSelector) {
      args.push('--wait-for', waitForSelector);
    }

    const proc = spawn('python3', args);
    const chunks = [];
    let stderr = '';

    proc.stdout.on('data', (data) => chunks.push(data));
    proc.stderr.on('data', (data) => {
      stderr += data;
      const msg = data.toString().trim();
      if (msg) console.error('[fetch_html]', msg);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'));
      } else {
        reject(new Error(stderr.trim() || `fetch_html.py exited with code ${code}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

/**
 * Fetches and parses a grading company URL using the appropriate scraper.
 * Returns { scraper, parsed } without writing anything to disk or DB.
 * Throws if no scraper matches the URL or if fetching/parsing fails.
 */
async function scrapeUrl(url) {
  const scraper = getScraperForNote({ url, grading_company: '' });

  if (!scraper) {
    throw new Error('No scraper is implemented for this grading company yet.');
  }

  const html = await fetchHtml(url, scraper.getWaitForSelector());
  const parsed = scraper.parse(html, url);

  return { scraper, parsed };
}

async function runScrapeJob(notes) {
  beginOperation('scraping', { total: notes.length });

  try {
    scrapeState.status = 'running';
    scrapeState.total = notes.length;
    scrapeState.completed = 0;
    scrapeState.startedAt = new Date().toISOString();
    scrapeState.finishedAt = null;
    scrapeState.error = null;
    scrapeState.items = notes.map((note) => ({
      noteId: note.id,
      label: `${note.denomination || 'Unknown'} - ${note.catalog_number || 'No catalog'} - ${note.serial || 'No serial'}`,
      status: 'queued',
      error: null
    }));

    for (const note of notes) {
      const stateItem = scrapeState.items.find((item) => item.noteId === note.id);
      scrapeState.currentNoteId = note.id;

      if (stateItem) stateItem.status = 'running';

      try {
        const { scraper, parsed } = await scrapeUrl(note.url);
        const images = await scraper.downloadImages(parsed);

        updateScrapeResult({ id: note.id, scrapedData: parsed.details, images, scrapeStatus: 'done', scrapeError: null });
        if (stateItem) { stateItem.status = 'done'; stateItem.error = null; }
      } catch (error) {
        updateScrapeResult({ id: note.id, scrapedData: null, images: note.images, scrapeStatus: 'failed', scrapeError: error.message });
        if (stateItem) { stateItem.status = 'failed'; stateItem.error = error.message; }
      } finally {
        scrapeState.completed += 1;
      }
    }

    scrapeState.status = 'done';
    scrapeState.currentNoteId = null;
    scrapeState.finishedAt = new Date().toISOString();
  } finally {
    endOperation('scraping');
  }
}

scrapeRouter.get('/status', (_request, response) => {
  response.json({
    ...scrapeState,
    currentOperation: getOperationStatus().currentOperation
  });
});

scrapeRouter.post('/start', async (request, response) => {
  if (shouldDisableScraping()) {
    rejectScrapingDisabled(response);
    return;
  }

  try {
    if (scrapeState.status === 'running') {
      throw createOperationConflictError('Scraping');
    }

    if (getOperationStatus().isBusy) {
      throw createOperationConflictError('Scraping');
    }
  } catch (error) {
    response.status(error.statusCode || 409).json({ error: error.message, currentOperation: error.currentOperation });
    return;
  }

  const ids = Array.isArray(request.body.ids) ? request.body.ids.map(Number).filter(Boolean) : [];
  const notes = getNotesByIds(ids).filter((note) => note.url);

  if (!notes.length) {
    response.status(400).json({ error: 'Please select at least one note with a URL.' });
    return;
  }

  setIdleState();
  runScrapeJob(notes).catch((error) => {
    scrapeState.status = 'done';
    scrapeState.currentNoteId = null;
    scrapeState.finishedAt = new Date().toISOString();
    scrapeState.error = error.message;
    console.error(error);
  });

  response.json({ message: 'Scrape job started.', total: notes.length });
});

scrapeRouter.post('/preview', async (request, response) => {
  if (shouldDisableScraping()) {
    rejectScrapingDisabled(response);
    return;
  }

  const url = typeof request.body.url === 'string' ? request.body.url.trim() : '';

  if (!url) {
    response.status(400).json({ error: 'A URL is required.' });
    return;
  }

  try {
    const { parsed } = await scrapeUrl(url);

    response.json({
      scraped_data: parsed.details,
      images: parsed.images.map((img) => ({
        type: img.side,
        variant: img.variant,
        sourceUrl: img.url
      }))
    });
  } catch (error) {
    const isNoScraper = error.message.includes('No scraper is implemented');
    response.status(isNoScraper ? 400 : 500).json({ error: error.message });
  }
});

export { scrapeRouter };
