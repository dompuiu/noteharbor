import { getTableColumn } from "./tableColumns.js";

// The All notes screen's read-only column model. It borrows every note
// column's label, kind, alignment, sorting, filtering and width metadata from
// the shared Table model, then overrides only this screen's geometry: a sticky
// Collection column and no pinned identity block. Editing columns (reorder,
// selection, actions) do not exist here.
const noteColumn = (key, overrides) => ({
  ...getTableColumn(key),
  sticky: false,
  ...overrides,
});

export const allNotesColumns = [
  {
    key: "collection",
    label: "Collection",
    kind: "data",
    width: 200,
    align: "left",
    sortable: true,
    sticky: true,
    hideable: false,
    filterable: false,
    matchMode: null,
    multiple: false,
    normalize: null,
    isTags: false,
    slideshowFilter: false,
  },
  noteColumn("thumbnail", { align: "center" }),
  noteColumn("catalog_number"),
  noteColumn("denomination"),
  noteColumn("issue_date"),
  noteColumn("grading_company"),
  noteColumn("grade", { align: "center" }),
  noteColumn("serial"),
  noteColumn("tags"),
];

export const hideableAllNotesColumns = allNotesColumns.filter(
  (column) => column.hideable,
);

export const hideableAllNotesColumnKeys = hideableAllNotesColumns.map(
  (column) => column.key,
);

export const allNotesDefaultSortKey = "collection";

export function defaultAllNotesVisibleColumnKeys() {
  return [...hideableAllNotesColumnKeys];
}

function keepsADataColumn(columnKeys) {
  return columnKeys.some(
    (key) => allNotesColumns.find((column) => column.key === key)?.kind === "data",
  );
}

function normalizeVisibleColumnKeys(value) {
  if (!Array.isArray(value)) {
    return defaultAllNotesVisibleColumnKeys();
  }

  const savedKeys = hideableAllNotesColumnKeys.filter((key) =>
    value.includes(key),
  );

  return keepsADataColumn(savedKeys)
    ? savedKeys
    : defaultAllNotesVisibleColumnKeys();
}

const allNotesTableStateStorageKey = "noteharbor.allNotesTableState";

// Columns are the only structural choice the All notes screen keeps for
// itself; filters, collection scope and sort live in the URL.
export function loadAllNotesVisibleColumnKeys() {
  if (typeof window === "undefined") {
    return defaultAllNotesVisibleColumnKeys();
  }

  try {
    const rawValue = window.localStorage.getItem(
      allNotesTableStateStorageKey,
    );

    if (!rawValue) {
      return defaultAllNotesVisibleColumnKeys();
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      throw new Error("Saved All notes table state is not an object");
    }

    return normalizeVisibleColumnKeys(parsedValue.visibleColumnKeys);
  } catch {
    window.localStorage.removeItem(allNotesTableStateStorageKey);
    return defaultAllNotesVisibleColumnKeys();
  }
}

export function saveAllNotesVisibleColumnKeys(visibleColumnKeys) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    allNotesTableStateStorageKey,
    JSON.stringify({
      visibleColumnKeys: normalizeVisibleColumnKeys(visibleColumnKeys),
    }),
  );
}

// The one field column that must stay visible: once it is alone, its checkbox
// is disabled so the table cannot be reduced to identity columns only.
export function lastVisibleAllNotesDataColumnKey(visibleColumnKeys) {
  const visibleDataKeys = hideableAllNotesColumns
    .filter(
      (column) =>
        column.kind === "data" && visibleColumnKeys.includes(column.key),
    )
    .map((column) => column.key);

  return visibleDataKeys.length === 1 ? visibleDataKeys[0] : null;
}
