// The filter bar's chip model, shared by the Table screen and the filter bar
// component. A condition is one chip: a field, a value, and an optional
// negation. The bar only ever hands the table committed conditions.
export const defaultFilterField = "catalog_number";

const filterFieldLabels = {
  all: "All fields",
  catalog_number: "Catalog",
  denomination: "Denomination",
  issue_date: "Date",
  grading_company: "Company",
  grade: "Grade",
  serial: "Serial",
  tags: "Tags",
};

export function filterFieldLabel(field) {
  return filterFieldLabels[field] ?? "All fields";
}

export function filterPlaceholderFor(field) {
  return field === "all"
    ? "Search every visible field…"
    : `Filter ${filterFieldLabel(field).toLowerCase()}…`;
}

let conditionSeq = 0;

export function makeCondition(field, value, negated = false) {
  conditionSeq += 1;
  return { id: `filter-${conditionSeq}`, field, value, negated };
}

export function conditionIdentity(condition) {
  return `${condition.field}:${condition.negated ? "!" : ""}${condition.value.toLowerCase()}`;
}

// A range is two endpoints with the same non-digit prefix (`22-25`, `M1-M8`).
// The right side may inherit the left's prefix (`M1-8`), a descending pair
// swaps (`25-22`), and zero padding is kept (`M01-M03`). Anything else is one
// literal value, exactly as before this existed.
const rangeEndpoint = /^([^\d]*)(\d+)$/;
// A range may not quietly become hundreds of chips: above this the commit is
// refused, so the parser reports it instead of expanding.
export const maxRangeValues = 100;

// Returns the values a token expands to, or null when its range is too wide.
function expandRangeValue(value) {
  const endpoints = value.split("-");

  if (endpoints.length !== 2) {
    return [value];
  }

  const left = rangeEndpoint.exec(endpoints[0].trim());
  const right = rangeEndpoint.exec(endpoints[1].trim());

  if (!left || !right || (right[1] || left[1]) !== left[1]) {
    return [value];
  }

  const low = Math.min(Number(left[2]), Number(right[2]));
  const high = Math.max(Number(left[2]), Number(right[2]));
  const count = high - low + 1;

  if (count > maxRangeValues) {
    return null;
  }

  // One zero-padded side pads both, to the wider digit count.
  const width =
    left[2].startsWith("0") || right[2].startsWith("0")
      ? Math.max(left[2].length, right[2].length)
      : 0;

  return Array.from(
    { length: count },
    (_, index) => `${left[1]}${String(low + index).padStart(width, "0")}`,
  );
}

// Chips already present win: identity is per chip and case-insensitive, so
// `M1-M3, M2` adds no second M2.
export function appendConditions(conditions, incoming) {
  const seen = new Set(conditions.map(conditionIdentity));
  const added = incoming.filter((condition) => {
    const identity = conditionIdentity(condition);

    if (seen.has(identity)) {
      return false;
    }

    seen.add(identity);
    return true;
  });

  return [...conditions, ...added];
}

// Commit is the one path for typed values and tag picks. Replace (the default)
// gives way to the incoming values for the committed field only: every other
// field keeps its chips and its insertion order, and a field with no prior
// chip is simply appended. Add widens the same-field OR.
export function commitConditions(conditions, field, incoming, mode) {
  if (mode === "add") {
    return appendConditions(conditions, incoming);
  }

  return appendConditions(
    conditions.filter((condition) => condition.field !== field),
    incoming,
  );
}

// One committed input may carry several values (`22, 19`), a range (`M1-M8`)
// and a negation (`!PMG`); each value becomes its own chip so the row states
// exactly what it means. A range wider than the cap refuses the whole commit,
// so the typed draft can stay in the field. A caller that cannot refuse (a
// slideshow link) asks for `expandRanges: false` and gets the text verbatim.
export function parseFilterInput(field, raw, { expandRanges = true } = {}) {
  const parsed = [];

  for (const token of String(raw ?? "").split(",")) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    const negated = trimmed.startsWith("!");
    const value = (negated ? trimmed.slice(1) : trimmed).trim();

    if (!value) {
      continue;
    }

    const values = expandRanges ? expandRangeValue(value) : [value];

    if (values === null) {
      return { conditions: [], tooWide: true };
    }

    for (const item of values) {
      parsed.push(makeCondition(field, item, negated));
    }
  }

  return { conditions: appendConditions([], parsed), tooWide: false };
}

// Chips grouped by field: same-field values OR, different fields AND.
export function groupConditions(conditions) {
  const groups = new Map();

  for (const condition of conditions) {
    if (!groups.has(condition.field)) {
      groups.set(condition.field, []);
    }
    groups.get(condition.field).push(condition);
  }

  return Array.from(groups, ([field, items]) => ({ field, items }));
}
