function parseBooleanEnv(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "on"].includes(normalized);
}

function detectDesktopRuntime() {
  if (parseBooleanEnv(import.meta.env.VITE_DESKTOP_RUNTIME)) {
    return true;
  }

  if (typeof window !== "undefined" && window.noteHarborDesktop) {
    return true;
  }

  return false;
}

const isScrapingDisabled = parseBooleanEnv(import.meta.env.VITE_DISABLE_SCRAPING);
const isDesktopRuntime = detectDesktopRuntime();

export { isDesktopRuntime, isScrapingDisabled };
