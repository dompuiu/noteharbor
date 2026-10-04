import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOpenPage } from './fetchHtml.js';

function createPage(url) {
  const page = {
    currentUrl: url,
    gotoCalls: [],
    broughtToFront: false,
    url: () => page.currentUrl,
    goto: async (target) => {
      page.gotoCalls.push(target);
      page.currentUrl = target;
    },
    bringToFront: async () => {
      page.broughtToFront = true;
    }
  };

  return page;
}

function createBrowser(contexts) {
  return { contexts: () => contexts };
}

function createContext(pages) {
  return {
    pages: () => pages,
    newPage: async () => {
      const page = createPage('about:blank');
      pages.push(page);
      return page;
    }
  };
}

test('resolveOpenPage reuses a matching tab, ignoring hash and trailing slash', async () => {
  const target = createPage('https://www.pmgnotes.com/certlookup/12345/');
  const context = createContext([createPage('about:blank'), target]);
  const browser = createBrowser([context]);

  const page = await resolveOpenPage(browser, 'https://www.pmgnotes.com/certlookup/12345#details');

  assert.equal(page, target);
  assert.equal(target.gotoCalls.length, 0);
});

test('resolveOpenPage ignores chrome-devtools tabs', async () => {
  const context = createContext([
    createPage('chrome-devtools://devtools/bundled/inspector.html'),
    createPage('https://www.pcgs.com/banknotes/cert/456')
  ]);
  const browser = createBrowser([context]);

  await assert.rejects(
    resolveOpenPage(browser, 'chrome-devtools://devtools/bundled/inspector.html'),
    /No open browser tab matches the requested URL/
  );
});

test('resolveOpenPage throws when no tab matches and openIfMissing is false', async () => {
  const context = createContext([createPage('https://www.pmgnotes.com/certlookup/1')]);
  const browser = createBrowser([context]);

  await assert.rejects(
    resolveOpenPage(browser, 'https://www.pmgnotes.com/certlookup/999'),
    /No open browser tab matches the requested URL/
  );
});

test('resolveOpenPage opens and navigates a new tab when openIfMissing is true', async () => {
  const context = createContext([createPage('https://www.pmgnotes.com/certlookup/1')]);
  const browser = createBrowser([context]);

  const page = await resolveOpenPage(browser, 'https://www.pmgnotes.com/certlookup/999', {
    openIfMissing: true
  });

  assert.deepEqual(page.gotoCalls, ['https://www.pmgnotes.com/certlookup/999']);
  assert.equal(page.url(), 'https://www.pmgnotes.com/certlookup/999');
  assert.equal(page.broughtToFront, true);
});

test('resolveOpenPage leaves the new tab open when navigation fails', async () => {
  const failingPage = createPage('about:blank');
  failingPage.goto = async () => {
    throw new Error('net::ERR_CONNECTION_REFUSED');
  };
  const pages = [];
  const context = {
    pages: () => pages,
    newPage: async () => {
      pages.push(failingPage);
      return failingPage;
    }
  };
  const browser = createBrowser([context]);

  await assert.rejects(
    resolveOpenPage(browser, 'https://www.pmgnotes.com/certlookup/999', { openIfMissing: true }),
    /ERR_CONNECTION_REFUSED/
  );

  assert.equal(failingPage.broughtToFront, true);
  assert.deepEqual(context.pages(), [failingPage]);
});

test('resolveOpenPage still reuses a matching tab when openIfMissing is true', async () => {
  const target = createPage('https://www.pmgnotes.com/certlookup/999');
  const context = createContext([target]);
  const browser = createBrowser([context]);

  const page = await resolveOpenPage(browser, 'https://www.pmgnotes.com/certlookup/999', {
    openIfMissing: true
  });

  assert.equal(page, target);
  assert.equal(context.pages().length, 1);
});

test('resolveOpenPage rejects a missing requested URL', async () => {
  const browser = createBrowser([createContext([])]);

  await assert.rejects(resolveOpenPage(browser, '  '), /No requested URL was provided/);
});
