// The Table screen's column model. Every column the table renders — including
// the non-data ones — is described once here, so filtering, sorting, slideshow
// context, rendering and (later) sizing/pinning all read the same list instead
// of keeping parallel key lists.
//
// This is a prefactor: metadata such as width, align and sticky is declared
// but not applied yet. Labels, keys, column order and behaviour match the
// table as it stood before the model was extracted.

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
    width: 26,
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
    width: 64,
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
    width: 230,
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

export function matchesSearchQuery(note, query) {
  const needle = String(query ?? "")
    .trim()
    .toLowerCase();

  if (!needle) {
    return true;
  }

  return dataColumns.some((column) =>
    searchableColumnValue(note, column).toLowerCase().includes(needle),
  );
}

export const displayOrderColumn = tableColumns.find(
  (column) => column.kind === "order",
);

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
