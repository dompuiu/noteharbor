import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Router } from 'express';
import { getNotesByIds, updateScrapeResult, SCRAPED_IMAGES_DIR } from '../db.js';
import { PMGScraper } from '../scrapers/pmg.js';

const scrapeRouter = Router();
const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const FETCH_SCRIPT = path.resolve(ROUTES_DIR, '../../fetch_html.py');
const DEFAULT_PMG_PREP_URL = 'https://www.pmgnotes.com/certlookup/';
const DEFAULT_PMG_PROFILE_DIR = path.resolve(ROUTES_DIR, '../../storage/browser_profiles/pmg');

const scrapeState = {
  status: 'idle',
  waitSeconds: 10,
  total: 0,
  completed: 0,
  currentNoteId: null,
  items: [],
  startedAt: null,
  finishedAt: null,
  error: null
};

const pmgPrepState = {
  status: 'idle',
  startedAt: null,
  targetUrl: null,
  error: null
};

let pmgPrepProcess = null;

function getProfileDir() {
  return process.env.PMG_BROWSER_PROFILE_DIR || DEFAULT_PMG_PROFILE_DIR;
}

function normalizePmgUrl(value) {
  if (!value) return DEFAULT_PMG_PREP_URL;
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().includes('pmgnotes.com') ? parsed.href : DEFAULT_PMG_PREP_URL;
  } catch {
    return DEFAULT_PMG_PREP_URL;
  }
}

function setIdleState() {
  scrapeState.status = 'idle';
  scrapeState.waitSeconds = 10;
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

  return null;
}

/**
 * Spawns fetch_html.py to open the page with crawl4ai and return the raw HTML.
 * The browser runs headless=False so the user can interact with bot challenges.
 */
function fetchHtml(url, waitSeconds) {
  return new Promise((resolve, reject) => {
    const args = [
      FETCH_SCRIPT,
      url,
      '--wait', String(waitSeconds),
      '--profile-dir', getProfileDir()
    ];

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

function openPmgPreparationBrowser(targetUrl) {
  const normalizedUrl = normalizePmgUrl(targetUrl);

  if (pmgPrepProcess && !pmgPrepProcess.killed) {
    return Promise.resolve(normalizedUrl);
  }

  return new Promise((resolve, reject) => {
    const args = [
      FETCH_SCRIPT,
      '--prepare',
      normalizedUrl,
      '--profile-dir', getProfileDir()
    ];

    pmgPrepProcess = spawn('python3', args);

    pmgPrepProcess.stdout.once('data', () => {
      pmgPrepState.status = 'open';
      pmgPrepState.startedAt = pmgPrepState.startedAt || new Date().toISOString();
      pmgPrepState.targetUrl = normalizedUrl;
      pmgPrepState.error = null;
      resolve(normalizedUrl);
    });

    pmgPrepProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[fetch_html prepare]', msg);
    });

    pmgPrepProcess.on('close', () => {
      pmgPrepProcess = null;
      pmgPrepState.status = 'idle';
      pmgPrepState.startedAt = null;
      pmgPrepState.targetUrl = null;
      pmgPrepState.error = null;
    });

    pmgPrepProcess.on('error', (err) => {
      pmgPrepProcess = null;
      pmgPrepState.status = 'failed';
      pmgPrepState.error = err.message;
      reject(err);
    });
  });
}

async function runScrapeJob(notes, waitSeconds) {
  scrapeState.status = 'running';
  scrapeState.waitSeconds = waitSeconds;
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

    const scraper = getScraperForNote(note);

    if (!scraper) {
      const errorMessage = 'No scraper is implemented for this grading company yet.';
      updateScrapeResult({ id: note.id, scrapedData: null, images: [], scrapeStatus: 'failed', scrapeError: errorMessage });
      if (stateItem) { stateItem.status = 'failed'; stateItem.error = errorMessage; }
      scrapeState.completed += 1;
      continue;
    }

    try {
      const html = await fetchHtml(note.url, waitSeconds);
      const parsed = scraper.parse(html, note.url);
      const images = await scraper.downloadImages(parsed);

      updateScrapeResult({ id: note.id, scrapedData: parsed.details, images, scrapeStatus: 'done', scrapeError: null });
      if (stateItem) { stateItem.status = 'done'; stateItem.error = null; }
    } catch (error) {
      updateScrapeResult({ id: note.id, scrapedData: null, images: [], scrapeStatus: 'failed', scrapeError: error.message });
      if (stateItem) { stateItem.status = 'failed'; stateItem.error = error.message; }
    } finally {
      scrapeState.completed += 1;
    }
  }

  scrapeState.status = 'done';
  scrapeState.currentNoteId = null;
  scrapeState.finishedAt = new Date().toISOString();
}

scrapeRouter.get('/status', (_request, response) => {
  response.json({ ...scrapeState, pmgPreparation: pmgPrepState });
});

scrapeRouter.post('/prepare-pmg', async (request, response) => {
  if (scrapeState.status === 'running') {
    response.status(409).json({ error: 'Cannot open PMG preparation browser while a scrape job is running.' });
    return;
  }

  try {
    const targetUrl = await openPmgPreparationBrowser(request.body?.url);
    response.json({
      message: 'PMG preparation browser opened. Complete the Cloudflare check there, then return here and start scraping.',
      targetUrl,
      profileDir: getProfileDir()
    });
  } catch (error) {
    pmgPrepState.status = 'failed';
    pmgPrepState.error = error.message;
    response.status(500).json({ error: `Failed to open the PMG preparation browser. ${error.message}` });
  }
});

scrapeRouter.post('/start', async (request, response) => {
  if (scrapeState.status === 'running') {
    response.status(409).json({ error: 'A scrape job is already running.' });
    return;
  }

  const ids = Array.isArray(request.body.ids) ? request.body.ids.map(Number).filter(Boolean) : [];
  const waitSeconds = Number(request.body.waitSeconds) > 0 ? Number(request.body.waitSeconds) : 10;
  const notes = getNotesByIds(ids).filter((note) => note.url);

  if (!notes.length) {
    response.status(400).json({ error: 'Please select at least one note with a URL.' });
    return;
  }

  setIdleState();
  runScrapeJob(notes, waitSeconds);

  response.json({ message: 'Scrape job started.', total: notes.length, waitSeconds });
});

export { scrapeRouter };
