// The Catalog-family rule (CONTEXT.md): a base number and an optional single
// trailing letter. `22` matches `22`, `22a`, `22b`, and `22s`, but never `220`
// or `221` — the trailing character must be a letter, not a digit. Matching is
// case-insensitive. An empty query matches everything.
function matchesCatalogFamily(catalogNumber, query) {
  const base = String(query ?? "").trim().toUpperCase();

  if (!base) {
    return true;
  }

  const catalog = String(catalogNumber ?? "").trim().toUpperCase();

  if (!catalog) {
    return false;
  }

  if (catalog === base) {
    return true;
  }

  return (
    catalog.length === base.length + 1 &&
    catalog.startsWith(base) &&
    /[A-Z]/.test(catalog.slice(-1))
  );
}

export { matchesCatalogFamily };
