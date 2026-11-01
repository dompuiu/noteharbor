// The Table screen's column model. Every column the table renders — including
// the non-data ones — is described once here, so filtering, sorting, slideshow
// context, rendering and (later) sizing/pinning all read the same list instead
// of keeping parallel key lists.
//
// The model is applied at HEAD: the table renders from this list, and
// filtering, sorting, alignment, sizing, sticky pinning and the column picker
// all read the metadata below instead of keeping parallel key lists.
//
// `width` is exact for the non-data control columns (drag handle, selection,
// display order, thumbnail, row actions). For a data column it is the flex
// weight: tableColumnWidths() shares the viewport leftover between the data
// columns in those proportions, so only the control columns are fixed.

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

// ── Sort values ──────────────────────────────────────────────────────────
// Filters and search read the printed text, but ordering must not: `1917`
// and `01/01/1917` are the same year yet compare as unrelated strings, and
// `1,000 Lei` sorts before `100 Lei`. A column that reads as a number or a
// date declares `sortValue`, and the table orders on that instead of on the
// rendered string. Null means "cannot be read" and always sorts last, so a
// missing field never floats to the top of a view labelled "sorted by date".

const MONTH_FIRST_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const YEAR_ONLY = /^\d{4}$/;

// Returns a YYYYMMDD-shaped number. The stored dates are month-first
// (`12/21/1938`, `05/13/1893`), so the first group is the month. A year-only
// value is a year, not a missing date: it sorts as the first day of that
// year instead of being pushed to the end of the list.
export function parseNoteDate(value) {
  const raw = String(value ?? "").trim();

  if (!raw) {
    return null;
  }

  if (YEAR_ONLY.test(raw)) {
    return Number(raw) * 10000 + 101;
  }

  let match = raw.match(MONTH_FIRST_DATE);
  let year;
  let month;
  let day;

  if (match) {
    [, month, day, year] = match;
  } else {
    match = raw.match(ISO_DATE);

    if (!match) {
      return null;
    }

    [, year, month, day] = match;
  }

  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }

  return yearNumber * 10000 + monthNumber * 100 + dayNumber;
}

const DENOMINATION_PATTERN = /^(\d[\d.,]*)\s*(.*)$/;

// Returns the denomination in the smallest unit the catalogue uses, so
// `25 Bani` (25) sorts below `1 Leu` (100) and `1,000 Lei` (100000) sorts
// above `100 Lei` (10000). The unit is part of the value, not a label.
export function parseDenominationValue(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(DENOMINATION_PATTERN);

  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));

  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = match[2].trim().toLowerCase();
  const perLeu = unit.startsWith("ban")
    ? 1
    : unit.startsWith("leu") || unit.startsWith("lei")
      ? 100
      : 1;

  return amount * perLeu;
}

const GRADE_NUMBER = /(\d+(?:\.\d+)?)/;

// Returns the grade's numeric part. The suffix (EPQ, PL, a star) is a
// qualifier on the same grade, so a `66 EPQ` and a `66` tie and are broken
// by the display string rather than by the alphabet.
export function parseGradeValue(value) {
  const match = String(value ?? "").match(GRADE_NUMBER);

  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);

  return Number.isFinite(numeric) ? numeric : null;
}

// For data columns `width` is a preferred share of the viewport rather than a
// pixel width: the shares are close to the space each field needs, so the
// table stretches evenly instead of one short-code column swallowing the
// slack. The whole row still fills the viewport at every width.
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
  // Optional `(note) => number | null`: the ordering value, when the printed
  // text is not the sort the collector means (see parseNoteDate).
  sortValue: null,
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
    // The drag cell is the row's outer left edge, so it pins with the
    // identity block: the selection border then stays at that edge instead
    // of sliding under the pinned columns when the table is panned.
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
    // Display order is part of the row's identity: pin it with the selection
    // and thumbnail cells so panning the data columns can never slide it
    // under the pinned block.
    sticky: true,
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
    label: "Front",
    kind: "thumbnail",
    // The 56px front image and the FRONT header both fit, with 6px of
    // padding on each side. A note is identified by its picture, so the
    // image gets the size of a field, not of an icon.
    width: 68,
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
    // The row's primary label: it holds a collector's eye, so it carries the
    // largest share of the leftover viewport.
    width: 200,
    multiple: true,
    normalize: normalizeDenominationFilterValue,
    sortValue: (note) => parseDenominationValue(note.denomination),
  }),
  scalarColumn("issue_date", "Date", {
    width: 110,
    multiple: true,
    sortValue: (note) => parseNoteDate(note.issue_date),
  }),
  scalarColumn("grading_company", "Company", {
    width: 96,
  }),
  scalarColumn("grade", "Grade", {
    width: 110,
    multiple: true,
    sortValue: (note) => parseGradeValue(note.grade),
  }),
  scalarColumn("serial", "Serial", {
    width: 132,
  }),
  scalarColumn("tags", "Tags", {
    // A flex weight rather than a fixed width: every data column scales with
    // the viewport, while the control columns keep their exact width. The
    // chip strip is the second-widest share, so a couple of tags fit before
    // the overflow marker has to stand in for them.
    width: 180,
    isTags: true,
  }),
  {
    key: "actions",
    // The header renders no visible label (the three-dot button explains
    // itself); the string is only the column's accessible name.
    label: "ACTIONS",
    kind: "actions",
    // The 30px row menu button plus 4px of compact padding each side, with a
    // little breathing room so it does not touch the tags column.
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

// Computes the rendered width of every visible column for a table of
// `tableWidth` px. Control columns keep their declared width exactly; the data
// columns share the leftover in proportion to their declared width, so they
// flex with the viewport while the identity columns stay put. `reservedWidth`
// covers cells outside the model, such as the scrollbar gutter.
export function tableColumnWidths(
  visibleColumns,
  tableWidth,
  reservedWidth = 0,
) {
  const widths = {};
  const fixedColumns = visibleColumns.filter(
    (column) => column.kind !== "data",
  );
  const flexibleColumns = visibleColumns.filter(
    (column) => column.kind === "data",
  );
  const fixedTotal = fixedColumns.reduce(
    (sum, column) => sum + (column.width ?? 0),
    0,
  );
  const available = Math.max(0, tableWidth - reservedWidth - fixedTotal);
  const weightTotal = flexibleColumns.reduce(
    (sum, column) => sum + (column.width ?? 0),
    0,
  );

  for (const column of fixedColumns) {
    widths[column.key] = column.width ?? 0;
  }

  // Give the last flexible column whatever rounding is left, so the columns
  // always add up to the table width and the browser has no leftover to
  // spread across — and thereby stretch — the fixed columns.
  let remaining = available;

  flexibleColumns.forEach((column, index) => {
    const isLast = index === flexibleColumns.length - 1;
    const width = isLast
      ? remaining
      : weightTotal > 0
        ? (available * (column.width ?? 0)) / weightTotal
        : available / flexibleColumns.length;

    widths[column.key] = Math.max(0, width);
    remaining -= width;
  });

  return widths;
}

// Pinned columns stay put while the table pans, so each needs the sum of the
// declared widths of the pinned columns that come before it. Only *visible*
// pinned columns count: a hidden column must leave no gap in the pinned block.
// A pinned data column flexes, so the caller may pass the rendered widths
// instead of the model's preferred widths.
export function stickyOffsets(visibleColumns = tableColumns, widths = null) {
  const offsets = {};
  let left = 0;

  for (const column of visibleColumns) {
    if (!column.sticky) {
      continue;
    }

    offsets[column.key] = left;
    left += widths?.[column.key] ?? column.width ?? 0;
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
