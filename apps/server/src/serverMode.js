function parseBooleanEnv(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function shouldDisableScraping() {
  return parseBooleanEnv(process.env.NOTE_HARBOR_DISABLE_SCRAPING);
}

function rejectScrapingDisabled(response) {
  response.status(403).json({ error: 'Scraping is disabled in this build.' });
}

export {
  parseBooleanEnv,
  rejectScrapingDisabled,
  shouldDisableScraping
};
