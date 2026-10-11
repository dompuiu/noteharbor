// Shared showcase note label parts. The showcase card shows the denomination,
// the catalog number, and the issue date in that order; the catalog number
// renders with its Pick prefix (`17` -> `Pick 17`, `22a` -> `Pick 22a`).
// Values already carrying a `P`/`Pick` prefix are normalized so stored `P17`
// or `Pick17` never becomes `Pick Pick 17`.
function formatShowcaseCatalogNumber(value) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return "";
  }

  const pickRest = trimmed.replace(/^pick\s*/i, "");

  if (pickRest !== trimmed) {
    return `Pick ${pickRest.trim()}`.trim();
  }

  const bare = trimmed.replace(/^p\s*/i, "");

  return `Pick ${bare.trim()}`.trim();
}

function showcaseNoteDisplayParts(note) {
  const denomination = String(note?.denomination ?? "").trim();
  const catalogNumber = formatShowcaseCatalogNumber(note?.catalog_number);
  const issueDate = String(note?.issue_date ?? "").trim();

  return [denomination, catalogNumber, issueDate].filter(Boolean);
}

export { formatShowcaseCatalogNumber, showcaseNoteDisplayParts };
