// Shared showcase note label parts. A note's caption shows the denomination,
// the catalog number, and the issue date in that order; the catalog number
// renders with its Pick prefix (`17` -> `Pick 17`, `22a` -> `Pick 22a`).
// Values already carrying a `P`/`Pick` prefix are normalized so stored `P17`
// or `Pick17` never becomes `Pick Pick 17`.
//
// `compact` shortens the prefix to `P` (`P17`) for a small card's title bar,
// where the whole line has to survive in about 130px.
function formatShowcaseCatalogNumber(value, { compact = false } = {}) {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return "";
  }

  const bare = trimmed
    .replace(/^pick\s*/i, "")
    .replace(/^p\s*/i, "")
    .trim();

  if (compact) {
    return bare ? `P${bare}` : "";
  }

  return `Pick ${bare}`.trim();
}

function showcaseNoteDisplayParts(note) {
  const denomination = String(note?.denomination ?? "").trim();
  const catalogNumber = formatShowcaseCatalogNumber(note?.catalog_number);
  const issueDate = String(note?.issue_date ?? "").trim();

  return [denomination, catalogNumber, issueDate].filter(Boolean);
}

// A showcase card's title, in the order the bar reads: the catalog number is
// the position's identifier and leads, the issue date follows, and the
// denomination closes the line.
function showcaseNoteTitleParts(note, { compact = false } = {}) {
  const catalogNumber = formatShowcaseCatalogNumber(note?.catalog_number, {
    compact,
  });
  const issueDate = String(note?.issue_date ?? "").trim();
  const denomination = String(note?.denomination ?? "").trim();

  return [catalogNumber, issueDate, denomination].filter(Boolean);
}

export {
  formatShowcaseCatalogNumber,
  showcaseNoteDisplayParts,
  showcaseNoteTitleParts,
};
