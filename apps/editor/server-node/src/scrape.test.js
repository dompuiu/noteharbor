import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getScraperForNote } from './routes/scrape.js';
import { PMGScraper } from './scrapers/pmg.js';
import { PCGSScraper } from './scrapers/pcgs.js';
import { TQGScraper } from './scrapers/tqg.js';

// Scrape seam: scraper selection by URL/company + POST /api/scrape/preview
// validation. No live browser: only paths that answer before any fetch.

test('a pmg url selects the pmg scraper', () => {
  const scraper = getScraperForNote({ url: 'https://www.pmgnotes.com/cert/123', grading_company: '' });
  assert.ok(scraper instanceof PMGScraper);
});

test('a pmg company selects the pmg scraper even without a url match', () => {
  const scraper = getScraperForNote({ url: 'https://example.com/x', grading_company: 'PMG' });
  assert.ok(scraper instanceof PMGScraper);
});

test('a pcgs cert url selects the pcgs scraper', () => {
  const scraper = getScraperForNote({ url: 'https://www.pcgs.com/banknotes/cert/123', grading_company: '' });
  assert.ok(scraper instanceof PCGSScraper);
});

test('a tqg url or company selects the tqg scraper', () => {
  assert.ok(getScraperForNote({ url: 'https://tqggrading.com/query/abc', grading_company: '' }) instanceof TQGScraper);
  assert.ok(getScraperForNote({ url: 'https://example.com/x', grading_company: 'tqg' }) instanceof TQGScraper);
});

test('an unknown site selects no scraper', () => {
  assert.equal(getScraperForNote({ url: 'https://example.com/cert/1', grading_company: '' }), null);
  assert.equal(getScraperForNote({ url: '', grading_company: '' }), null);
});

let serverModule;
let tempDir;
let server;
let baseUrl;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noteharbor-scrape-test-'));
  process.env.NOTE_HARBOR_DATA_DIR = tempDir;
  serverModule = await import('./index.js');
  ({ server } = await serverModule.startServer({ host: '127.0.0.1', port: 0 }));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  const db = await import('./db.js');
  db.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test('preview without a url answers 400', async () => {
  const { response, body } = await api('/api/scrape/preview', {
    method: 'POST',
    body: JSON.stringify({ url: '   ' })
  });
  assert.equal(response.status, 400);
  assert.match(body.error, /A URL is required/);
});

test('preview for an unsupported site answers 400 without touching a browser', async () => {
  const { response, body } = await api('/api/scrape/preview', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://example.com/cert/1' })
  });
  assert.equal(response.status, 400);
  assert.match(body.error, /No scraper is implemented/);
});
