import {
  defaultSortKey,
  tableColumns,
  validSortKeys,
} from "./tableColumns.js";
import {
  defaultVisibleColumnKeysFor,
  keepsADataColumnIn,
  normalizeVisibleColumnKeysFor,
  readStoredTableState,
  writeStoredTableState,
} from "./tableViewState.js";

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

// The desktop shell serves the UI from an embedded server on a random port,
// so every launch is a fresh localStorage origin. These bridge calls mirror
// the per-collection structures into the file-backed preferences and refill
// localStorage before the app mounts; the web build has no bridge and keeps
// using localStorage alone.
function getDesktopTableStateBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  const bridge = window.noteHarborDesktop;

  if (
    !bridge ||
    typeof bridge.getTableStates !== "function" ||
    typeof bridge.setTableState !== "function" ||
    typeof bridge.removeTableState !== "function" ||
    typeof bridge.clearTableStates !== "function"
  ) {
    return null;
  }

  return bridge;
}

function isStoredTableState(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Runs once before the app mounts. A localStorage key already present wins,
// because it belongs to the current session and is at least as new as the
// file.
export async function hydrateDesktopTableStates() {
  if (typeof window === "undefined") {
    return;
  }

  const bridge = getDesktopTableStateBridge();

  if (!bridge) {
    return;
  }

  let storedStates;

  try {
    storedStates = await bridge.getTableStates();
  } catch {
    return;
  }

  if (!isStoredTableState(storedStates)) {
    return;
  }

  for (const [rawCollectionId, tableState] of Object.entries(storedStates)) {
    const collectionId = Number.parseInt(rawCollectionId, 10);

    if (
      String(collectionId) !== rawCollectionId ||
      !isPersistableCollectionId(collectionId) ||
      !isStoredTableState(tableState)
    ) {
      continue;
    }

    const storageKey = tableStateStorageKey(collectionId);

    if (window.localStorage.getItem(storageKey) !== null) {
      continue;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(tableState));
  }
}

export function defaultVisibleColumnKeys() {
  return defaultVisibleColumnKeysFor(tableColumns);
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
  return keepsADataColumnIn(tableColumns, columnKeys);
}

function isPersistableCollectionId(collectionId) {
  return Number.isInteger(collectionId) && collectionId > 0;
}

function normalizeVisibleColumnKeys(value) {
  return normalizeVisibleColumnKeysFor(tableColumns, value);
}

export function loadTableState(collectionId) {
  if (
    !isPersistableCollectionId(collectionId) ||
    typeof window === "undefined"
  ) {
    return defaultTableState();
  }

  const storageKey = tableStateStorageKey(collectionId);
  const parsedValue = readStoredTableState(storageKey);

  if (!parsedValue) {
    return defaultTableState();
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
}

export function saveTableState(collectionId, tableState) {
  if (
    !isPersistableCollectionId(collectionId) ||
    typeof window === "undefined"
  ) {
    return;
  }

  const storedState = {
    sortKey: tableState.sortKey,
    sortDirection: tableState.sortDirection,
    visibleColumnKeys: tableState.visibleColumnKeys,
  };

  writeStoredTableState(tableStateStorageKey(collectionId), storedState);
  getDesktopTableStateBridge()
    ?.setTableState(collectionId, storedState)
    ?.catch(() => {});
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
  const bridge = getDesktopTableStateBridge();

  for (const key of storedTableStateKeys()) {
    if (liveKeys.has(key)) {
      continue;
    }

    window.localStorage.removeItem(key);

    const collectionId = Number.parseInt(
      key.slice(`${tableStateStorageKeyPrefix}.`.length),
      10,
    );

    if (isPersistableCollectionId(collectionId)) {
      bridge?.removeTableState(collectionId)?.catch(() => {});
    }
  }
}

// An import renumbers collections (and the archive itself renumbers them on
// export), so an id-keyed payload would attach to whatever collection lands on
// that id next. The table structure starts fresh after a successful import.
export function clearAllTableStates() {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of storedTableStateKeys()) {
    window.localStorage.removeItem(key);
  }

  getDesktopTableStateBridge()?.clearTableStates()?.catch(() => {});
  clearLegacyTableState();
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
