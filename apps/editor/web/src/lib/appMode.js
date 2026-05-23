function parseBooleanEnv(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "on"].includes(normalized);
}

function detectDesktopRuntime() {
  if (typeof window !== "undefined" && window.noteHarborDesktop) {
    return true;
  }

  if (typeof navigator === "undefined") {
    return false;
  }

  return navigator.userAgent.includes("note-harbor-desktop");
}

const isScrapingDisabled = parseBooleanEnv(import.meta.env.VITE_DISABLE_SCRAPING);
const isDesktopRuntime = detectDesktopRuntime();

export { isDesktopRuntime, isScrapingDisabled };
