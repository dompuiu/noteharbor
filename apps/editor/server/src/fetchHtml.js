import { chromium } from 'playwright';

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

function selectOpenPage(browser, requestedUrl) {
  const normalizedRequestedUrl = normalizeUrl(requestedUrl);

  if (!normalizedRequestedUrl) {
    throw new Error('No requested URL was provided for open-tab selection.');
  }

  const pages = browser.contexts().flatMap((context) => context.pages());
  const realPages = pages.filter((page) => !page.url().startsWith('chrome-devtools://'));
  const nonBlankPages = realPages.filter((page) => page.url() && page.url() !== 'about:blank');
  const matchingPages = nonBlankPages.filter((page) => normalizeUrl(page.url()) === normalizedRequestedUrl);

  if (matchingPages.length) {
    return matchingPages.at(-1);
  }

  throw new Error(
    [
      'No open browser tab matches the requested URL.',
      `Requested: ${requestedUrl}`,
      `Open tabs:\n${describeOpenPages(realPages)}`
    ].join('\n')
  );
}

async function fetchHtml({ url, cdpUrl, waitSeconds }) {
  if (typeof waitSeconds !== 'number' || Number.isNaN(waitSeconds) || waitSeconds < 0) {
    throw new Error('waitSeconds must be a non-negative number');
  }

  if (!cdpUrl) {
    throw new Error('A CDP URL is required');
  }

  let browser;

  try {
    browser = await chromium.connectOverCDP(cdpUrl, { noDefaults: true });
    const page = selectOpenPage(browser, url);

    if (waitSeconds > 0) {
      await page.waitForTimeout(waitSeconds * 1000);
    }

    return await page.content();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/cdp|connectOverCDP|ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(message)) {
      throw new Error(`${buildCdpHint(cdpUrl)}\n${message}`);
    }

    throw error;
  } finally {
    await browser?.close().catch(() => {});
  }
}

export { fetchHtml };
