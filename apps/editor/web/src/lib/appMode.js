function parseBooleanEnv(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "on"].includes(normalized);
}

const isScrapingDisabled = parseBooleanEnv(import.meta.env.VITE_DISABLE_SCRAPING);

export { isScrapingDisabled };
