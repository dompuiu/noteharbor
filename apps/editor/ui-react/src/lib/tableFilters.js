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

// One committed input may carry several values (`22, 19`) and a negation
// (`!PMG`); each becomes its own chip so the row states exactly what it means.
export function conditionsFromInput(field, raw) {
  const parsed = [];

  for (const token of String(raw ?? "").split(",")) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    const negated = trimmed.startsWith("!");
    const value = (negated ? trimmed.slice(1) : trimmed).trim();

    if (value) {
      parsed.push(makeCondition(field, value, negated));
    }
  }

  return parsed;
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
