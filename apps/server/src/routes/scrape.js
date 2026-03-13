import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { PlaywrightCrawler } from 'crawlee';
import { chromium } from 'playwright';
import { getNotesByIds, updateScrapeResult } from '../db.js';
import { PMGScraper } from '../scrapers/pmg.js';

const scrapeRouter = Router();
const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PMG_PROFILE_DIR = path.resolve(ROUTES_DIR, '../../storage/browser_profiles/pmg');
const DEFAULT_PMG_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const DEFAULT_PMG_PREP_URL = 'https://www.pmgnotes.com/certlookup/';
const CHROME_EXECUTABLE_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];
const PMG_RESULT_SELECTOR = '.certlookup-results-data';
const PMG_CHALLENGE_TEXT = [
  'verify you are human',
  'press and hold',
  'please verify you are a human',
  'captcha',
  'bot detection'
];

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

let pmgPrepContextPromise = null;

function getChromeExecutablePath() {
  const configuredPath = process.env.CRAWLEE_CHROME_EXECUTABLE_PATH;

  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  return CHROME_EXECUTABLE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function createLaunchContext() {
  const chromeExecutablePath = getChromeExecutablePath();
  const profileDir = process.env.PMG_BROWSER_PROFILE_DIR || DEFAULT_PMG_PROFILE_DIR;
  const userAgent = process.env.PMG_BROWSER_USER_AGENT || DEFAULT_PMG_USER_AGENT;
  const useChrome = process.env.PMG_USE_CHROME === '0' ? false : Boolean(chromeExecutablePath);

  return {
    userDataDir: profileDir,
    userAgent,
    useChrome,
    launchOptions: {
      headless: false,
      executablePath: chromeExecutablePath ?? undefined,
      args: ['--start-maximized']
    }
  };
}

function createPersistentBrowserConfig() {
  const launchContext = createLaunchContext();

  return {
    profileDir: launchContext.userDataDir,
    launchOptions: {
      ...launchContext.launchOptions,
      userAgent: launchContext.userAgent,
      viewport: null
    }
  };
}

function normalizePmgUrl(value) {
  if (!value) {
    return DEFAULT_PMG_PREP_URL;
  }

  try {
    const parsedUrl = new URL(value);

    if (!parsedUrl.hostname.toLowerCase().includes('pmgnotes.com')) {
      return DEFAULT_PMG_PREP_URL;
    }

    return parsedUrl.href;
  } catch {
    return DEFAULT_PMG_PREP_URL;
  }
}

async function openPmgPreparationBrowser(targetUrl) {
  const normalizedUrl = normalizePmgUrl(targetUrl);

  if (!pmgPrepContextPromise) {
    const { profileDir, launchOptions } = createPersistentBrowserConfig();
    pmgPrepContextPromise = chromium.launchPersistentContext(profileDir, launchOptions);

    try {
      const context = await pmgPrepContextPromise;

      context.on('close', () => {
        pmgPrepContextPromise = null;
        pmgPrepState.status = 'idle';
        pmgPrepState.startedAt = null;
        pmgPrepState.targetUrl = null;
        pmgPrepState.error = null;
      });
    } catch (error) {
      pmgPrepContextPromise = null;
      throw error;
    }
  }

  const context = await pmgPrepContextPromise;
  const existingPage = context.pages()[0] ?? (await context.newPage());

  await existingPage.goto(normalizedUrl, { waitUntil: 'domcontentloaded' });
  await existingPage.bringToFront();

  pmgPrepState.status = 'open';
  pmgPrepState.startedAt = pmgPrepState.startedAt || new Date().toISOString();
  pmgPrepState.targetUrl = normalizedUrl;
  pmgPrepState.error = null;

  return normalizedUrl;
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

function getScraperForNote(note) {
  const url = note.url?.toLowerCase() ?? '';
  const company = note.grading_company?.toLowerCase() ?? '';

  if (url.includes('pmgnotes.com') || company.includes('pmg')) {
    return new PMGScraper(note);
  }

  return null;
}

async function waitForPmgPage(page, waitSeconds) {
  const timeoutMs = Math.max(waitSeconds * 1000, 30000);
  const pollIntervalMs = 500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pageState = await page.evaluate(
      ({ resultSelector, challengeTexts }) => {
        const bodyText = document.body?.innerText?.toLowerCase() ?? '';
        const hasResults = Boolean(document.querySelector(resultSelector));
        const hasChallenge = challengeTexts.some((text) => bodyText.includes(text));

        return { hasResults, hasChallenge };
      },
      {
        resultSelector: PMG_RESULT_SELECTOR,
        challengeTexts: PMG_CHALLENGE_TEXT
      }
    );

    if (pageState.hasResults) {
      return;
    }

    await page.waitForTimeout(pollIntervalMs);
  }

  const finalState = await page.evaluate(
    ({ resultSelector, challengeTexts }) => {
      const bodyText = document.body?.innerText?.toLowerCase() ?? '';
      return {
        hasResults: Boolean(document.querySelector(resultSelector)),
        hasChallenge: challengeTexts.some((text) => bodyText.includes(text))
      };
    },
    {
      resultSelector: PMG_RESULT_SELECTOR,
      challengeTexts: PMG_CHALLENGE_TEXT
    }
  );

  if (finalState.hasResults) {
    return;
  }

  if (finalState.hasChallenge) {
    throw new Error(
      `PMG bot challenge was still active after ${Math.ceil(timeoutMs / 1000)} seconds. Solve it in the opened browser or increase the wait time and try again.`
    );
  }

  throw new Error('PMG page loaded, but the certification details did not appear.');
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

  const crawler = new PlaywrightCrawler({
    maxConcurrency: 1,
    maxRequestRetries: 0,
    requestHandlerTimeoutSecs: Math.max(waitSeconds + 30, 60),
    useSessionPool: false,
    launchContext: createLaunchContext(),
    async requestHandler({ page, request }) {
      const note = request.userData.note;
      const stateItem = scrapeState.items.find((item) => item.noteId === note.id);
      const scraper = getScraperForNote(note);

      scrapeState.currentNoteId = note.id;
      if (stateItem) {
        stateItem.status = 'running';
      }

      if (!scraper) {
        if (stateItem) {
          stateItem.status = 'failed';
          stateItem.error = 'No scraper is implemented for this grading company yet.';
        }

        updateScrapeResult({
          id: note.id,
          scrapedData: null,
          images: [],
          scrapeStatus: 'failed',
          scrapeError: 'No scraper is implemented for this grading company yet.'
        });
        scrapeState.completed += 1;
        return;
      }

      try {
        if (note.url?.toLowerCase().includes('pmgnotes.com')) {
          await waitForPmgPage(page, waitSeconds);
        } else {
          await page.waitForTimeout(waitSeconds * 1000);
        }

        const html = await page.content();
        const parsed = scraper.parse(html, request.loadedUrl || note.url);
        const downloadedImages = await scraper.downloadImages(parsed);

        updateScrapeResult({
          id: note.id,
          scrapedData: parsed.details,
          images: downloadedImages,
          scrapeStatus: 'done',
          scrapeError: null
        });

        if (stateItem) {
          stateItem.status = 'done';
          stateItem.error = null;
        }
      } catch (error) {
        if (stateItem) {
          stateItem.status = 'failed';
          stateItem.error = error.message;
        }

        updateScrapeResult({
          id: note.id,
          scrapedData: null,
          images: [],
          scrapeStatus: 'failed',
          scrapeError: error.message
        });
      } finally {
        scrapeState.completed += 1;
      }
    },
    failedRequestHandler({ request }, error) {
      const note = request.userData.note;
      const stateItem = scrapeState.items.find((item) => item.noteId === note.id);
      const errorMessage = error?.message ?? 'Scrape failed.';
      const previousStatus = stateItem?.status;

      if (stateItem) {
        stateItem.status = 'failed';
        stateItem.error = errorMessage;
      }

      updateScrapeResult({
        id: note.id,
        scrapedData: null,
        images: [],
        scrapeStatus: 'failed',
        scrapeError: errorMessage
      });

      if (previousStatus !== 'done' && previousStatus !== 'failed') {
        scrapeState.completed += 1;
      }
    }
  });

  try {
    await crawler.run(
      notes.map((note) => ({
        url: note.url,
        uniqueKey: String(note.id),
        userData: { note }
      }))
    );
    scrapeState.status = 'done';
  } catch (error) {
    scrapeState.status = 'failed';
    scrapeState.error = error.message;
  } finally {
    scrapeState.currentNoteId = null;
    scrapeState.finishedAt = new Date().toISOString();
  }
}

scrapeRouter.get('/status', (_request, response) => {
  response.json({
    ...scrapeState,
    pmgPreparation: pmgPrepState
  });
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
      profileDir: process.env.PMG_BROWSER_PROFILE_DIR || DEFAULT_PMG_PROFILE_DIR
    });
  } catch (error) {
    pmgPrepState.status = 'failed';
    pmgPrepState.error = error.message;

    response.status(500).json({
      error: `Failed to open the PMG preparation browser. ${error.message}`
    });
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

  response.json({
    message: 'Scrape job started.',
    total: notes.length,
    waitSeconds
  });
});

export { scrapeRouter };
