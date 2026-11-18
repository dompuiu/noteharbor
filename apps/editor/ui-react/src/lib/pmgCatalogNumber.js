// Reads the catalog number out of PMG's note reference. PMG lists the note
// as the region code followed by the catalog number ("ROMM8" is Romanian
// M8, "ROM112a1" is Romanian 112a1), so the region has to come off before
// the catalog number is returned; a catalog prefix or a digit after the
// suffix letter would otherwise be dropped.
function extractCatalogNumberFromPmNote(noteValue, regionValue) {
  const normalized = String(noteValue ?? "").trim();
  if (!normalized) {
    return null;
  }

  const region = String(regionValue ?? "").trim();
  if (region && normalized.toUpperCase().startsWith(region.toUpperCase())) {
    const catalogNumber = normalized.slice(region.length).trim();
    if (catalogNumber) {
      return catalogNumber;
    }
  }

  // Pages without a region keep the historical digit-run read.
  const compact = normalized.replace(/[\s_-]+/g, "");
  const match = compact.match(/(\d+[A-Za-z]*)/);
  return match ? match[1] : null;
}

export { extractCatalogNumberFromPmNote };
