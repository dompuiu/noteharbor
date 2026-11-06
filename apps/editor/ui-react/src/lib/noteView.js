import {
  columnSearchMatches,
  dataColumns,
  defaultSortKey,
  getTableColumn,
  matchesSearchQuery,
  tagsColumnKey,
  validSortKeys,
} from "./tableColumns.js";
import { makeCondition } from "./tableFilters.js";

// Filtering, sorting, and URL-condition helpers shared by the Table screen and
// the All notes screen. The logic used to live in NotesTable.jsx; it moved here
// unchanged so both screens read one definition of filter and sort semantics.

function valueToString(note, key) {
  if (getTableColumn(key)?.isTags) {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

export function serializeConditions(conditions) {
  return (conditions ?? [])
    .map(
      (condition) =>
        `${encodeURIComponent(condition.field)}:${condition.negated ? "!" : ""}${encodeURIComponent(condition.value)}`,
    )
    .join(";");
}

export function parseConditionsParam(raw) {
  const parsed = [];

  for (const part of String(raw ?? "").split(";")) {
    const separator = part.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    const field = decodeURIComponent(part.slice(0, separator));
    let value = part.slice(separator + 1);
    let negated = false;

    if (value.startsWith("!")) {
      negated = true;
      value = value.slice(1);
    }

    try {
      value = decodeURIComponent(value);
    } catch {
      continue;
    }

    if (value.trim()) {
      parsed.push(makeCondition(field, value.trim(), negated));
    }
  }

  return parsed;
}

function parseFilterValue(rawValue, normalizeValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { negated: false, value: "" };
  }

  const negated = normalized.startsWith("!");
  const rawParsedValue = negated ? normalized.slice(1).trim() : normalized;
  const value = normalizeValue
    ? normalizeValue(rawParsedValue)
    : rawParsedValue;
  return value ? { negated, value } : { negated: false, value: "" };
}

function parseScalarFilters(rawFilterValue, normalizeValue) {
  return String(rawFilterValue ?? "")
    .split(",")
    .map((value) => parseFilterValue(value, normalizeValue))
    .filter(({ value }) => value);
}

function matchesCatalogFilterValue(noteValue, filterValue) {
  if (!noteValue.startsWith(filterValue)) {
    return false;
  }

  const nextCharacter = noteValue.charAt(filterValue.length);
  return !nextCharacter || !/\d/.test(nextCharacter);
}

function matchesSingleFilterValue(
  noteValue,
  filterValue,
  matchMode = "includes",
) {
  return matchMode === "catalogPrefix"
    ? matchesCatalogFilterValue(noteValue, filterValue)
    : matchMode === "startsWith"
      ? noteValue.startsWith(filterValue)
      : noteValue.includes(filterValue);
}

function matchesFilterValue(
  noteValue,
  rawFilterValue,
  matchMode = "includes",
  options = {},
) {
  const normalizedNoteValue = String(noteValue ?? "").toLowerCase();
  const filters = options.multiple
    ? parseScalarFilters(rawFilterValue, options.normalizeFilterValue)
    : [parseFilterValue(rawFilterValue, options.normalizeFilterValue)].filter(
        ({ value }) => value,
      );

  if (!filters.length) {
    return true;
  }

  const positiveFilters = filters.filter(({ negated }) => !negated);
  const negativeFilters = filters.filter(({ negated }) => negated);

  if (positiveFilters.length) {
    const hasPositiveMatch = positiveFilters.some(({ value }) =>
      matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
    );
    if (!hasPositiveMatch) {
      return false;
    }
  }

  return negativeFilters.every(
    ({ value }) =>
      !matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
  );
}

function matchesTagFilter(note, rawFilterValue) {
  const filters = parseScalarFilters(rawFilterValue);

  if (!filters.length) {
    return true;
  }

  const noteTagNames = note.tags.map((tag) =>
    String(tag.name ?? "")
      .trim()
      .toLowerCase(),
  );
  return filters.every(({ negated, value }) => {
    const hasMatch = noteTagNames.some((tagName) => tagName.startsWith(value));
    return negated ? !hasMatch : hasMatch;
  });
}

export function noteOrderValue(note) {
  const value = Number(note.display_order);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

// One shared collator: same result as String.localeCompare with these
// options, without rebuilding the collator on every comparison.
const rowSortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

// Filter chips: one field, one value, optionally negated. Values inside a
// field are ORed; different fields are ANDed; a negation must not match.
function groupConditions(conditions) {
  const groups = new Map();

  for (const condition of conditions ?? []) {
    if (!groups.has(condition.field)) {
      groups.set(condition.field, []);
    }
    groups.get(condition.field).push(condition);
  }

  return groups;
}

function conditionMatches(note, condition, searchColumns) {
  if (condition.field === "all") {
    return matchesSearchQuery(note, condition.value, searchColumns);
  }

  const column = getTableColumn(condition.field);

  if (!column) {
    return true;
  }

  if (column.isTags) {
    return matchesTagFilter(note, condition.value);
  }

  return matchesFilterValue(
    valueToString(note, column.key),
    condition.value,
    column.matchMode,
    { multiple: false, normalizeFilterValue: column.normalize },
  );
}

export function filterNotesByConditions(noteList, conditions, searchColumns) {
  if (!conditions?.length) {
    return noteList;
  }

  const groups = groupConditions(conditions);

  return noteList.filter((note) => {
    for (const list of groups.values()) {
      const positives = list.filter((condition) => !condition.negated);

      if (
        positives.length &&
        !positives.some((condition) =>
          conditionMatches(note, condition, searchColumns),
        )
      ) {
        return false;
      }

      for (const condition of list) {
        if (
          condition.negated &&
          conditionMatches(note, condition, searchColumns)
        ) {
          return false;
        }
      }
    }

    return true;
  });
}

// Which columns each row matched, so the table can mark the terms instead of
// leaving the collector to guess why a row is there.
export function marksForNote(
  note,
  conditions,
  searchColumns,
  { normalized = false } = {},
) {
  const marks = {};
  const add = (key, term) => {
    const list = marks[key] ?? (marks[key] = []);
    if (!list.includes(term)) {
      list.push(term);
    }
  };

  for (const condition of conditions ?? []) {
    if (condition.negated) {
      continue;
    }

    if (!conditionMatches(note, condition, searchColumns)) {
      continue;
    }

    if (condition.field === "all") {
      const terms = String(condition.value)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      for (const term of terms) {
        for (const column of searchColumns) {
          if (columnSearchMatches(note, column, term)) {
            add(column.key, term);

            // Find asks for the normalised spelling too: `2300` finds
            // `2,300`, and a row tinted with no visible mark reads as a bug.
            // Filters keep their existing raw-term marks.
            if (normalized && column.normalize) {
              const normalizedTerm = String(column.normalize(term)).trim();

              if (normalizedTerm && normalizedTerm !== term) {
                add(column.key, normalizedTerm);
              }
            }
          }
        }
      }
    } else {
      add(condition.field, condition.value);
    }
  }

  return marks;
}

export function sortNotesBySort(noteList, key, direction) {
  const sortKey = validSortKeys.has(key) ? key : defaultSortKey;
  const sortDirection = direction === "desc" ? "desc" : "asc";
  const sortValue = getTableColumn(sortKey)?.sortValue ?? null;
  return [...noteList].sort((left, right) => {
    if (sortKey === defaultSortKey) {
      const orderResult = noteOrderValue(left) - noteOrderValue(right);
      const result = orderResult || left.id - right.id;
      return sortDirection === "asc" ? result : -result;
    }

    const leftText = valueToString(left, sortKey).toLowerCase();
    const rightText = valueToString(right, sortKey).toLowerCase();
    // Ordering on the printed text is wrong the moment a column carries a
    // number or a date (`1917` vs `01/01/1917`, `1,000 Lei` vs `100 Lei`), so
    // a column that can be read declares its own comparable value.
    const leftValue = sortValue ? sortValue(left) : null;
    const rightValue = sortValue ? sortValue(right) : null;
    const leftMissing = leftValue == null || Number.isNaN(leftValue);
    const rightMissing = rightValue == null || Number.isNaN(rightValue);

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        // Both unreadable: fall back to the printed text, in the same
        // direction, so a column of free-form values still reverses.
        const result = rowSortCollator.compare(leftText, rightText);
        return sortDirection === "asc" ? result : -result;
      }

      // An unreadable value is an absence, not a smallest value: it sits at
      // the end in both directions instead of leading "sorted by date".
      return leftMissing ? 1 : -1;
    }

    const result =
      leftValue === rightValue
        ? rowSortCollator.compare(leftText, rightText)
        : leftValue - rightValue;
    return sortDirection === "asc" ? result : -result;
  });
}

export function applyTableView(
  noteList,
  conditions,
  key,
  direction,
  searchColumns = dataColumns,
) {
  return sortNotesBySort(
    filterNotesByConditions(noteList, conditions, searchColumns),
    key,
    direction,
  );
}

// The All notes screen's collection sort: collection sidebar order, then each
// collection's own note order. Direction reverses only the collection blocks,
// so descending still reads naturally inside a collection.
export function sortNotesByCollection(noteList, direction) {
  return [...noteList].sort((left, right) => {
    const leftCollection = Number(left.collection_order);
    const rightCollection = Number(right.collection_order);
    const leftOrder = Number.isFinite(leftCollection)
      ? leftCollection
      : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(rightCollection)
      ? rightCollection
      : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return direction === "desc"
        ? rightOrder - leftOrder
        : leftOrder - rightOrder;
    }

    return noteOrderValue(left) - noteOrderValue(right) || left.id - right.id;
  });
}

// Clicking a tag in either table applies it as a Tags chip. A plain click adds
// to the current Tags chips; Shift replaces them.
export function addTagCondition(
  conditions,
  tagName,
  { replace = false } = {},
) {
  const others = replace
    ? conditions.filter((condition) => condition.field !== tagsColumnKey)
    : conditions;

  if (
    others.some(
      (condition) =>
        condition.field === tagsColumnKey &&
        !condition.negated &&
        condition.value.toLowerCase() === tagName.toLowerCase(),
    )
  ) {
    return others;
  }

  return [...others, makeCondition(tagsColumnKey, tagName)];
}
