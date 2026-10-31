// The Table screen's column model. Every column the table renders — including
// the non-data ones — is described once here, so filtering, sorting, slideshow
// context, rendering and (later) sizing/pinning all read the same list instead
// of keeping parallel key lists.
//
// The model is applied at HEAD: the table renders from this list, and
// filtering, sorting, alignment, sizing, sticky pinning and the column picker
// all read the metadata below instead of keeping parallel key lists.

function addThousandsSeparators(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Denominations are stored with thousands separators (`$1,000`), so a filter
// typed as `1000` has to be normalised before it can match.
export function normalizeDenominationFilterValue(value) {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^(\d[\d,]*)(\.\d+)?(.*)$/);
  if (!match) {
    return trimmed;
  }

  const [, rawIntegerPart, decimalPart = "", suffix = ""] = match;
  const integerDigits = rawIntegerPart.replace(/,/g, "");
  if (!/^\d+$/.test(integerDigits)) {
    return trimmed;
  }

  return `${addThousandsSeparators(integerDigits)}${decimalPart}${suffix}`;
}

const scalarColumn = (key, label, overrides = {}) => ({
  key,
  label,
  kind: "data",
  width: null,
  align: "left",
  sortable: true,
  sticky: false,
  hideable: true,
  filterable: true,
  matchMode: "includes",
  multiple: false,
  normalize: null,
  isTags: false,
  slideshowFilter: true,
  ...overrides,
});

export const tableColumns = [
  {
    key: "reorder",
    label: "",
    kind: "reorder",
    // The drag handle is 12px of dots; 6px of breathing room on each side
    // keeps the target at the 24px accessibility minimum.
    width: 24,
    align: "center",
    sortable: false,
    sticky: false,
    hideable: false,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
  {
    key: "selection",
    label: "",
    kind: "selection",
    width: 44,
    align: "center",
    sortable: false,
    sticky: true,
    hideable: false,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
  {
    key: "id",
    // Display order, not the note id: the `#` label keeps collectors from
    // reading this column as a database identifier.
    label: "#",
    kind: "order",
    // Sized for four tabular digits in the body and the active sort chevron
    // in the header, with 4px of horizontal cell padding.
    width: 48,
    align: "right",
    sortable: true,
    sticky: false,
    hideable: true,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
  {
    key: "thumbnail",
    label: "FRONT",
    kind: "thumbnail",
    // The 48px front image and the FRONT header both fit, with 4px of
    // padding on each side.
    width: 58,
    align: "center",
    sortable: false,
    sticky: true,
    hideable: false,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
  scalarColumn("catalog_number", "Catalog #", {
    width: 116,
    sticky: true,
    hideable: false,
    matchMode: "catalogPrefix",
    multiple: true,
  }),
  scalarColumn("denomination", "Denomination", {
    width: 150,
    multiple: true,
    normalize: normalizeDenominationFilterValue,
  }),
  scalarColumn("issue_date", "Date", {
    width: 96,
    multiple: true,
  }),
  scalarColumn("grading_company", "Company", {
    width: 106,
  }),
  scalarColumn("grade", "Grade", {
    width: 96,
    multiple: true,
  }),
  scalarColumn("serial", "Serial", {
    width: 148,
  }),
  scalarColumn("tags", "Tags", {
    // No width: the table's flexible column, sized from the viewport leftover
    // so a wide window cannot stretch the fixed identity columns.
    width: null,
    isTags: true,
  }),
  {
    key: "actions",
    label: "ACTIONS",
    kind: "actions",
    width: 54,
    align: "center",
    sortable: false,
    sticky: false,
    hideable: false,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
];

const byKey = new Map(tableColumns.map((column) => [column.key, column]));

export function getTableColumn(key) {
  return byKey.get(key) ?? null;
}

export const dataColumns = tableColumns.filter(
  (column) => column.kind === "data",
);

// The columns the collector may hide, in table order. Everything else
// (selection, thumbnail, catalog number, actions, reorder) is permanent.
export const hideableColumns = tableColumns.filter((column) => column.hideable);

export const hideableColumnKeys = hideableColumns.map((column) => column.key);

// Hiding is only a choice for field columns; at least one of these must stay
// visible so the table is never reduced to identity columns alone.
export const hideableDataColumns = hideableColumns.filter(
  (column) => column.kind === "data",
);

// The search field looks across every data column, including tag names. It is
// deliberately broader than a column filter: one substring, case-insensitive,
// matched against any one field.
export const searchColumnKeys = dataColumns.map((column) => column.key);

function searchableColumnValue(note, column) {
  if (column.isTags) {
    return (note.tags ?? [])
      .map((tag) => String(tag.name ?? "").trim())
      .join(" ");
  }

  return String(note[column.key] ?? "");
}

function searchableColumnMatches(note, column, needle) {
  const value = searchableColumnValue(note, column);

  // Denominations are stored with thousands separators, so the query goes
  // through the same normaliser as the column filter: `1000` finds `$1,000`.
  if (column.normalize) {
    return String(column.normalize(value))
      .toLowerCase()
      .includes(String(column.normalize(needle)).toLowerCase());
  }

  return value.toLowerCase().includes(needle);
}

export function matchesSearchQuery(note, query) {
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();

  if (!needle) {
    return true;
  }

  return dataColumns.some((column) =>
    searchableColumnMatches(note, column, needle),
  );
}

export const displayOrderColumn = tableColumns.find(
  (column) => column.kind === "order",
);

// Pinned columns stay put while the table pans, so each needs the sum of the
// declared widths of the pinned columns that come before it. Only *visible*
// pinned columns count: a hidden column must leave no gap in the pinned block.
export function stickyOffsets(visibleColumns = tableColumns) {
  const offsets = {};
  let left = 0;

  for (const column of visibleColumns) {
    if (!column.sticky) {
      continue;
    }

    offsets[column.key] = left;
    left += column.width ?? 0;
  }

  return offsets;
}

// The right-most pinned column carries the pan shadow. It is derived from the
// visible set rather than document order so a hidden column moves the marker
// with the block.
export function lastStickyKey(visibleColumns = tableColumns) {
  for (let index = visibleColumns.length - 1; index >= 0; index -= 1) {
    if (visibleColumns[index].sticky) {
      return visibleColumns[index].key;
    }
  }

  return null;
}

// Display order is the table's default sort and still sorts under the `id`
// key, exactly as it did before the column model.
export const defaultSortKey = displayOrderColumn.key;

export const tagsColumn = tableColumns.find((column) => column.isTags);

export const tagsColumnKey = tagsColumn.key;

export const filterColumns = tableColumns.filter((column) => column.filterable);

export const filterColumnKeys = filterColumns.map((column) => column.key);

export const slideshowFilterColumns = tableColumns.filter(
  (column) => column.slideshowFilter,
);

export const slideshowFilterKeys = slideshowFilterColumns.map(
  (column) => column.key,
);

export const sortableColumns = tableColumns.filter((column) => column.sortable);

export const sortableColumnKeys = sortableColumns.map((column) => column.key);

export const validSortKeys = new Set(sortableColumnKeys);
