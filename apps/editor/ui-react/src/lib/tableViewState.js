// The column-preference rules both note tables share: which columns may be
// hidden, what a saved list normalizes to, and which one field column must
// stay visible. The storage shape stays with each screen; this module only
// owns the rules.
export function defaultVisibleColumnKeysFor(columns) {
  return columns
    .filter((column) => column.hideable)
    .map((column) => column.key);
}

export function keepsADataColumnIn(columns, columnKeys) {
  return columnKeys.some(
    (key) =>
      columns.find((column) => column.key === key)?.kind === "data",
  );
}

export function normalizeVisibleColumnKeysFor(columns, value) {
  const defaults = defaultVisibleColumnKeysFor(columns);

  if (!Array.isArray(value)) {
    return defaults;
  }

  const savedKeys = defaultVisibleColumnKeysFor(columns).filter((key) =>
    value.includes(key),
  );

  return keepsADataColumnIn(columns, savedKeys) ? savedKeys : defaults;
}

// The one field column that must stay visible: once it is alone, its checkbox
// is disabled so the table cannot be reduced to identity columns only.
export function lastVisibleDataColumnKeyIn(columns, visibleColumnKeys) {
  const visibleDataKeys = columns
    .filter(
      (column) =>
        column.hideable &&
        column.kind === "data" &&
        visibleColumnKeys.includes(column.key),
    )
    .map((column) => column.key);

  return visibleDataKeys.length === 1 ? visibleDataKeys[0] : null;
}

// Reads a stored table record without interpreting it. The caller owns the
// record's shape (sort + columns, or columns alone).
export function readStoredTableState(storageKey) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      throw new Error("Saved table state is not an object");
    }

    return parsedValue;
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function writeStoredTableState(storageKey, value) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

// The desktop shell serves the UI from an embedded server on a random port,
// so every launch is a fresh localStorage origin. These bridge calls mirror
// table structures into the file-backed preferences (keyed by collection id,
// plus `allNotes`), and the hydraters refill localStorage before the app
// mounts. The web build has no bridge and keeps using localStorage alone.
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
    typeof bridge.clearCollectionTableStates !== "function"
  ) {
    return null;
  }

  return bridge;
}

export async function readDesktopTableStates() {
  const bridge = getDesktopTableStateBridge();

  if (!bridge) {
    return null;
  }

  try {
    const states = await bridge.getTableStates();

    if (!states || typeof states !== "object" || Array.isArray(states)) {
      return null;
    }

    return states;
  } catch {
    return null;
  }
}

export function writeDesktopTableState(key, value) {
  getDesktopTableStateBridge()
    ?.setTableState(key, value)
    ?.catch(() => {});
}

export function removeDesktopTableState(key) {
  getDesktopTableStateBridge()
    ?.removeTableState(key)
    ?.catch(() => {});
}

export function clearDesktopCollectionTableStates() {
  getDesktopTableStateBridge()?.clearCollectionTableStates()?.catch(() => {});
}
