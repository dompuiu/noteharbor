import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PMGScraper } from './scrapers/pmg.js';
import { PCGSScraper } from './scrapers/pcgs.js';
import { TQGScraper } from './scrapers/tqg.js';

// Scraper seam: XScraper.parse(html, pageUrl). Fixtures are literal HTML with
// independently known answers — never recomputed from the implementation.

test('pmg parses details, cert number, comments, and both image sides', () => {
  const html = `
    <div class="certlookup-wrapper">
      <dl><dt>PMG Cert:</dt><dd>12345</dd></dl>
      <dl><dt>Grade:</dt><dd>65</dd></dl>
    </div>
    <div class="certlookup-images-item">
      <a href="https://images.example.com/full-front.jpg"><img title="Obverse" src="https://images.example.com/thumb-front.jpg" /></a>
    </div>
    <div class="certlookup-images-item">
      <a href="https://images.example.com/full-back.jpg"><img title="Reverse" src="https://images.example.com/thumb-back.jpg" /></a>
    </div>
    <p class="certlookup-disclaimer">Guaranteed genuine.</p>
  `;
  const pageUrl = 'https://www.pmgnotes.com/cert/12345';
  const parsed = new PMGScraper({ id: 7 }).parse(html, pageUrl);

  assert.equal(parsed.certNumber, '12345');
  assert.equal(parsed.details.pmg_cert, '12345');
  assert.equal(parsed.details.grade, '65');
  assert.equal(parsed.details.source_url, pageUrl);
  assert.equal(parsed.details.page_comments, 'Guaranteed genuine.');

  const byUrl = new Map(parsed.images.map((image) => [image.url, image]));
  assert.deepEqual(byUrl.get('https://images.example.com/full-front.jpg'), {
    side: 'front',
    variant: 'full',
    url: 'https://images.example.com/full-front.jpg'
  });
  assert.deepEqual(byUrl.get('https://images.example.com/full-back.jpg'), {
    side: 'back',
    variant: 'full',
    url: 'https://images.example.com/full-back.jpg'
  });
  assert.equal(byUrl.get('https://images.example.com/thumb-front.jpg').variant, 'thumbnail');
  assert.equal(byUrl.get('https://images.example.com/thumb-back.jpg').variant, 'thumbnail');
});

test('pmg falls back to the catalog number when the page has no cert', () => {
  const parsed = new PMGScraper({ id: 7, catalog_number: 'P-22' }).parse('<div></div>', 'https://x.example/');
  assert.equal(parsed.certNumber, 'P-22');
});

test('pcgs parses the embedded grade, cert, and images', () => {
  const html = `
    <html><body>
    <table><tr><td>Region:</td><td>Romania</td></tr></table>
    <script>const data = [{certNo:"999",displayGrade:"65",gradeDesc:"Gem Unc 65",opq:true,population:12,popHigher:3,country:"Romania",denomination:"5 Lei",currencySerialNumber:"A1",currencyDate:"1920",specNo:"S1",displayNoteNo:"N1",catalogNo1:"P-1",catalog1LongDesc:"Pick",banknoteDetails:"crisp",isNFCSecure:false,images:[{showThumbnail:true,label:"Obverse",downloadUrl:"https:\\/\\/i.example\\/f.jpg",thumbnailUrl:"https:\\/\\/i.example\\/t.jpg",popupUrl:"https:\\/\\/i.example\\/p.jpg"}]}]; Promise.all([])</script>
    </body></html>
  `;
  const parsed = new PCGSScraper({ id: 9 }).parse(html, 'https://www.pcgs.com/banknotes/cert/999');

  assert.equal(parsed.certNumber, '999');
  assert.equal(parsed.details.grade, '65 PPQ');
  assert.equal(parsed.details.serial_number, 'A1');
  assert.equal(parsed.details.country, 'Romania');
  assert.equal(parsed.details.source_url, 'https://www.pcgs.com/banknotes/cert/999');

  const byUrl = new Map(parsed.images.map((image) => [image.url, image]));
  assert.deepEqual(byUrl.get('https://i.example/p.jpg'), {
    side: 'front',
    variant: 'full',
    url: 'https://i.example/p.jpg'
  });
  assert.deepEqual(byUrl.get('https://i.example/t.jpg'), {
    side: 'front',
    variant: 'thumbnail',
    url: 'https://i.example/t.jpg'
  });
});

test('tqg parses the query table and resolves image urls against the page', () => {
  const html = `
    <div class="query_wrap">
      <table>
        <tr><td>Grade:</td><td>66</td></tr>
        <tr><td>Serial:</td><td>X9</td></tr>
      </table>
      <div class="thumbs"><img src="/img/front.jpg" /><img src="/img/back.jpg" /></div>
    </div>
  `;
  const pageUrl = 'https://tqggrading.com/query/ABC123';
  const parsed = new TQGScraper({ id: 3 }).parse(html, pageUrl);

  assert.equal(parsed.certNumber, 'ABC123');
  assert.equal(parsed.details.grade, '66');
  assert.equal(parsed.details.serial, 'X9');
  assert.equal(parsed.details.source_url, pageUrl);
  assert.deepEqual(parsed.images, [
    { side: 'front', variant: 'full', url: 'https://tqggrading.com/img/front.jpg' },
    { side: 'back', variant: 'full', url: 'https://tqggrading.com/img/back.jpg' }
  ]);
});

test('tqg falls back to the serial when the url has no query folder', () => {
  const parsed = new TQGScraper({ id: 3, serial: 'S-1' }).parse('<div class="query_wrap"></div>', 'https://x.example/');
  assert.equal(parsed.certNumber, 'S-1');
});
