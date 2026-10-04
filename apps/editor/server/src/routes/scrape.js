import { Router } from "express";
import { fetchHtml } from "../fetchHtml.js";
import { PCGSScraper } from "../scrapers/pcgs.js";
import { PMGScraper } from "../scrapers/pmg.js";
import { TQGScraper } from "../scrapers/tqg.js";

const scrapeRouter = Router();
const DEFAULT_WAIT_SECONDS = 2;
const DEFAULT_BROWSER_CDP_URL = "http://localhost:9222";

function getBrowserCdpUrl() {
  return (
    process.env.NOTE_HARBOR_BROWSER_CDP_URL?.trim() || DEFAULT_BROWSER_CDP_URL
  );
}

/**
 * Returns the appropriate scraper instance for a note, or null if unsupported.
 * Add new scrapers here as you support more grading companies / sites.
 */
function getScraperForNote(note) {
  const url = note.url?.toLowerCase() ?? "";
  const company = note.grading_company?.toLowerCase() ?? "";

  if (url.includes("pmgnotes.com") || company.includes("pmg")) {
    return new PMGScraper(note);
  }

  if (url.includes("pcgs.com/banknotes/cert/")) {
    return new PCGSScraper(note);
  }

  if (url.includes("tqggrading.com") || company.includes("tqg")) {
    return new TQGScraper(note);
  }

  return null;
}

/**
 * Fetches and parses a grading company URL using the appropriate scraper.
 * Returns { scraper, parsed } without writing anything to disk or DB.
 * Throws if no scraper matches the URL or if fetching/parsing fails.
 */
async function scrapeUrl(noteOrUrl, options = {}) {
  const note =
    typeof noteOrUrl === "string"
      ? { url: noteOrUrl, grading_company: "" }
      : noteOrUrl;
  const url = note?.url;
  const scraper = getScraperForNote(note);

  if (!scraper) {
    throw new Error("No scraper is implemented for this grading company yet.");
  }

  const html = await fetchHtml({
    url,
    cdpUrl: getBrowserCdpUrl(),
    waitSeconds: DEFAULT_WAIT_SECONDS,
    openIfMissing: options.openIfMissing,
    navigationTimeoutMs: options.navigationTimeoutMs,
  });
  const parsed = scraper.parse(html, url);

  return { scraper, parsed };
}

scrapeRouter.post("/preview", async (request, response) => {
  const url =
    typeof request.body.url === "string" ? request.body.url.trim() : "";

  if (!url) {
    response.status(400).json({ error: "A URL is required." });
    return;
  }

  try {
    const { parsed } = await scrapeUrl(url, {
      openIfMissing: true,
      navigationTimeoutMs: request.body?.timeoutMs,
    });

    response.json({
      scraped_data: parsed.details,
      images: parsed.images.map((img) => ({
        type: img.side,
        variant: img.variant,
        sourceUrl: img.url,
      })),
    });
  } catch (error) {
    const isNoScraper = error.message.includes("No scraper is implemented");
    response.status(isNoScraper ? 400 : 500).json({ error: error.message });
  }
});

export { scrapeRouter };
