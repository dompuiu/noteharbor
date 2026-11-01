import {
  defaultSortKey,
  getTableColumn,
  hideableColumnKeys,
  validSortKeys,
} from "./tableColumns.js";

// Table *structure* is a per-collection preference: how the rows are ordered
// and which columns are on screen. Filters, the search query and the selected
// rows are view state that dies with the view, so they never reach storage.
//
// One key per collection keeps every structural setting together and lets the
// shape grow. The two older keys are dropped on load: the global table state
// (sort + filters) and the per-collection column list.
const tableStateStorageKeyPrefix = "noteharbor.notesTableState";
const legacyColumnsStorageKeyPrefix = "noteharbor.notesTableColumns";

export function tableStateStorageKey(collectionId) {
  return `${tableStateStorageKeyPrefix}.${collectionId}`;
}

export function defaultVisibleColumnKeys() {
  return [...hideableColumnKeys];
}

export function defaultTableState() {
  return {
    sortKey: defaultSortKey,
    sortDirection: "asc",
    visibleColumnKeys: defaultVisibleColumnKeys(),
  };
}

// Hiding is only a choice for field columns; at least one of them must stay
// visible so the table is never reduced to identity columns alone.
export function keepsADataColumn(columnKeys) {
  return columnKeys.some((key) => getTableColumn(key)?.kind === "data");
}

function isPersistableCollectionId(collectionId) {
  return Number.isInteger(collectionId) && collectionId > 0;
}

function normalizeVisibleColumnKeys(value) {
  if (!Array.isArray(value)) {
    return defaultVisibleColumnKeys();
  }

  const savedKeys = hideableColumnKeys.filter((key) => value.includes(key));

  return keepsADataColumn(savedKeys)
    ? savedKeys
    : defaultVisibleColumnKeys();
}

export function loadTableState(collectionId) {
  if (
    !isPersistableCollectionId(collectionId) ||
    typeof window === "undefined"
  ) {
    return defaultTableState();
  }

  const storageKey = tableStateStorageKey(collectionId);

  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return defaultTableState();
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      throw new Error("Saved table state is not an object");
    }

    return {
      sortKey: validSortKeys.has(parsedValue.sortKey)
        ? parsedValue.sortKey
        : defaultSortKey,
      sortDirection: parsedValue.sortDirection === "desc" ? "desc" : "asc",
      visibleColumnKeys: normalizeVisibleColumnKeys(
        parsedValue.visibleColumnKeys,
      ),
    };
  } catch {
    window.localStorage.removeItem(storageKey);
    return defaultTableState();
  }
}

export function saveTableState(collectionId, tableState) {
  if (
    !isPersistableCollectionId(collectionId) ||
    typeof window === "undefined"
  ) {
    return;
  }

  window.localStorage.setItem(
    tableStateStorageKey(collectionId),
    JSON.stringify({
      sortKey: tableState.sortKey,
      sortDirection: tableState.sortDirection,
      visibleColumnKeys: tableState.visibleColumnKeys,
    }),
  );
}

function storedTableStateKeys() {
  const keys = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (key?.startsWith(`${tableStateStorageKeyPrefix}.`)) {
      keys.push(key);
    }
  }

  return keys;
}

// A deleted collection cannot be visited again, so its saved structure would
// only leak. Pruning against the live collection list keeps one key per
// collection and no more.
export function pruneTableStates(collectionIds) {
  if (!Array.isArray(collectionIds) || typeof window === "undefined") {
    return;
  }

  const liveKeys = new Set(collectionIds.map(tableStateStorageKey));

  for (const key of storedTableStateKeys()) {
    if (!liveKeys.has(key)) {
      window.localStorage.removeItem(key);
    }
  }
}

// The state this module replaces was written under a global key (with filters
// and selection in it) and a per-collection column key. Nothing reads them any
// more, so a single sweep keeps localStorage free of dead settings.
export function clearLegacyTableState() {
  if (typeof window === "undefined") {
    return;
  }

  const legacyKeys = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);

    if (
      key === tableStateStorageKeyPrefix ||
      key?.startsWith(`${legacyColumnsStorageKeyPrefix}.`)
    ) {
      legacyKeys.push(key);
    }
  }

  for (const key of legacyKeys) {
    window.localStorage.removeItem(key);
  }
}
