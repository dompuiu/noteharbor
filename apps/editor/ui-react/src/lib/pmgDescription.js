// Parses the PMG note description (e.g. "Romania, Banca Nationala,
// 500,000 Lei 2000-04 - Wmk: A. Vlaicu") into denomination and issue date.
function extractPmgDescriptionFields(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return {};
  }

  const cleaned = normalized
    .replace(/\s*"SPECIMEN"\s*/gi, " ")
    .replace(/\s+-\s+Wmk:\s*.+$/i, "")
    // Multiples are listed after the date ("10,000 Lei 2000 - Sheet of 4"):
    // strip the qualifier so the trailing date/denomination anchors match.
    .replace(/\s+-\s*(Uncut\s+)?Sheets?\s+of\s+\d+.*$/i, "")
    .replace(/\s+(Uncut\s+)?Sheets?\s+of\s+\d+\s*$/i, "")
    .trim();

  let issueDate = null;
  let denominationSource = cleaned;
  const ndMatch = cleaned.match(/\bND\s*\(([^)]+)\)\s*$/i);
  if (ndMatch) {
    issueDate = ndMatch[1].trim();
    denominationSource = cleaned.slice(0, ndMatch.index).trim();
  } else {
    const trailingDateMatch = cleaned.match(/(\d{4}(?:\s*-\s*\d{1,4})?)\s*$/);
    if (trailingDateMatch) {
      issueDate = trailingDateMatch[1].replace(/\s+/g, "");
      denominationSource = cleaned.slice(0, trailingDateMatch.index).trim();
    }
  }

  // A catalog reference can sit between the denomination and the date
  // ("500 Lei SB445 1944"): strip it so the trailing amount anchor matches.
  // The token starts with letters and contains digits, so pure-alpha
  // currency names ("Lei", "Mark") are untouched.
  denominationSource = denominationSource
    .replace(/\s+[A-Za-z]+-?\d+[A-Za-z0-9-]*$/, "")
    .trim();

  // Match the trailing amount on the full source. Splitting on commas
  // breaks thousands separators ("500,000 Lei" -> "000 Lei").
  const denominationMatch = denominationSource.match(
    /(\d[\d,./]*\s+[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\s*$/,
  );
  const denomination = denominationMatch?.[1]?.trim() || null;

  return {
    denomination,
    issueDate,
  };
}

export { extractPmgDescriptionFields };
