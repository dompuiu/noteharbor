import { chromium } from 'playwright-core';

function buildCdpHint(cdpUrl) {
  return [
    'Unable to reach the configured CDP browser endpoint.',
    `Verify ${cdpUrl.replace(/\/$/, '')}/json/version is reachable from the server environment.`,
    'If the server runs in WSL and Chrome runs on Windows, launch Chrome with',
    '--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 and point',
    'NOTE_HARBOR_BROWSER_CDP_URL at the Windows host IP instead of localhost if needed.'
  ].join(' ');
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/#.*$/, '').replace(/\/$/, '');
}

function describeOpenPages(realPages) {
  if (!realPages.length) {
    return '(no open browser tabs)';
  }

  return realPages.map((page) => `- ${page.url() || 'about:blank'}`).join('\n');
}

function findMatchingOpenPage(realPages, normalizedRequestedUrl) {
  return (
    realPages
      .filter((page) => page.url() && page.url() !== 'about:blank')
      .filter((page) => normalizeUrl(page.url()) === normalizedRequestedUrl)
      .at(-1) ?? null
  );
}

async function openMissingPage(context, requestedUrl) {
  if (!context) {
    throw new Error('The connected browser has no context to open a new tab in.');
  }

  const page = await context.newPage();

  await page.bringToFront();

  // If navigation fails the tab is left open so the user can see what broke;
  // the error propagates to the caller as a scrape failure.
  await page.goto(requestedUrl, { waitUntil: 'domcontentloaded' });

  return page;
}

async function resolveOpenPage(browser, requestedUrl, { openIfMissing = false } = {}) {
  const normalizedRequestedUrl = normalizeUrl(requestedUrl);

  if (!normalizedRequestedUrl) {
    throw new Error('No requested URL was provided for open-tab selection.');
  }

  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const realPages = pages.filter((page) => !page.url().startsWith('chrome-devtools://'));
  const matchingPage = findMatchingOpenPage(realPages, normalizedRequestedUrl);

  if (matchingPage) {
    return matchingPage;
  }

  if (openIfMissing) {
    return openMissingPage(contexts[0], requestedUrl);
  }

  throw new Error(
    [
      'No open browser tab matches the requested URL.',
      `Requested: ${requestedUrl}`,
      `Open tabs:\n${describeOpenPages(realPages)}`
    ].join('\n')
  );
}

async function fetchHtml({ url, cdpUrl, waitSeconds, openIfMissing = false }) {
  if (typeof waitSeconds !== 'number' || Number.isNaN(waitSeconds) || waitSeconds < 0) {
    throw new Error('waitSeconds must be a non-negative number');
  }

  if (!cdpUrl) {
    throw new Error('A CDP URL is required');
  }

  let browser;

  try {
    browser = await chromium.connectOverCDP(cdpUrl, { noDefaults: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${buildCdpHint(cdpUrl)}\n${message}`);
  }

  try {
    const page = await resolveOpenPage(browser, url, { openIfMissing });

    if (waitSeconds > 0) {
      await page.waitForTimeout(waitSeconds * 1000);
    }

    return await page.content();
  } finally {
    await browser?.close().catch(() => {});
  }
}

export { fetchHtml, resolveOpenPage };
