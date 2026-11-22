import { getTableColumn, validSortKeys } from "./tableColumns.js";
import {
  defaultVisibleColumnKeysFor,
  lastVisibleDataColumnKeyIn,
  normalizeVisibleColumnKeysFor,
  readDesktopTableStates,
  readStoredTableState,
  writeDesktopTableState,
  writeStoredTableState,
} from "./tableViewState.js";

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
  return defaultVisibleColumnKeysFor(allNotesColumns);
}

function normalizeVisibleColumnKeys(value) {
  return normalizeVisibleColumnKeysFor(allNotesColumns, value);
}

export const allNotesTableStateStorageKey = "noteharbor.allNotesTableState";
const desktopAllNotesTableStateKey = "allNotes";

export function defaultAllNotesTableState() {
  return {
    sortKey: null,
    sortDirection: "asc",
    visibleColumnKeys: defaultAllNotesVisibleColumnKeys(),
  };
}

function normalizeAllNotesSortKey(value, visibleColumnKeys) {
  if (value === allNotesDefaultSortKey) {
    return value;
  }

  if (!validSortKeys.has(value)) {
    return null;
  }

  const column = allNotesColumns.find((entry) => entry.key === value);

  // A fixed column is always on screen; a hideable one must still be visible
  // for its header to carry the sort.
  if (
    !column?.sortable ||
    (column.hideable && !visibleColumnKeys.includes(value))
  ) {
    return null;
  }

  return value;
}

// Columns and sort are the All notes screen's own structure. The collection
// scope, filter chips and find query stay view state; collection scope and
// filters live in the URL, and the sort is remembered here until a URL names
// its own (a bookmark or slideshow link).
export function loadAllNotesTableState() {
  const parsedValue = readStoredTableState(allNotesTableStateStorageKey);

  if (!parsedValue) {
    return defaultAllNotesTableState();
  }

  const visibleColumnKeys = normalizeVisibleColumnKeys(
    parsedValue.visibleColumnKeys,
  );

  return {
    sortKey: normalizeAllNotesSortKey(parsedValue.sortKey, visibleColumnKeys),
    sortDirection: parsedValue.sortDirection === "desc" ? "desc" : "asc",
    visibleColumnKeys,
  };
}

export function saveAllNotesTableState(tableState) {
  const storedState = {
    sortKey: tableState.sortKey,
    sortDirection: tableState.sortDirection === "desc" ? "desc" : "asc",
    visibleColumnKeys: normalizeVisibleColumnKeys(
      tableState.visibleColumnKeys,
    ),
  };

  writeStoredTableState(allNotesTableStateStorageKey, storedState);
  writeDesktopTableState(desktopAllNotesTableStateKey, storedState);
}

// Runs once before the app mounts, like the per-collection hydrater: the
// desktop shell's origin changes every launch, so its file-backed copy fills
// localStorage first. A key already present wins.
export async function hydrateDesktopAllNotesTableState() {
  if (typeof window === "undefined") {
    return;
  }

  const storedStates = await readDesktopTableStates();
  const tableState = storedStates?.[desktopAllNotesTableStateKey];

  if (
    !tableState ||
    typeof tableState !== "object" ||
    Array.isArray(tableState) ||
    window.localStorage.getItem(allNotesTableStateStorageKey) !== null
  ) {
    return;
  }

  window.localStorage.setItem(
    allNotesTableStateStorageKey,
    JSON.stringify(tableState),
  );
}

// The one field column that must stay visible: once it is alone, its checkbox
// is disabled so the table cannot be reduced to identity columns only.
export function lastVisibleAllNotesDataColumnKey(visibleColumnKeys) {
  return lastVisibleDataColumnKeyIn(allNotesColumns, visibleColumnKeys);
}
