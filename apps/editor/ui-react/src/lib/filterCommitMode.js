// The filter field commits in one of two modes. Replace, the default, swaps
// the committed field's chips; Add widens the same-field OR. The mode is one
// app-wide preference, so it lives under its own key: the table's structural
// payload is deliberately filter-free and must stay that way.
export const filterCommitModeStorageKey = "noteharbor.filterCommitMode";

export const defaultFilterCommitMode = "replace";

export function commitModeLabel(mode) {
  return mode === "add" ? "Add" : "Replace";
}

export function otherCommitMode(mode) {
  return mode === "add" ? "replace" : "add";
}

// Anything that is not the Add value is Replace, so a missing or corrupt
// preference can never leave the field without a working mode.
function normalizeFilterCommitMode(value) {
  return value === "add" ? "add" : defaultFilterCommitMode;
}

// A missing, invalid or unreadable value resolves to the default: a broken
// preference must never keep the field from committing.
export function loadFilterCommitMode() {
  if (typeof window === "undefined") {
    return defaultFilterCommitMode;
  }

  try {
    return normalizeFilterCommitMode(
      window.localStorage.getItem(filterCommitModeStorageKey),
    );
  } catch {
    return defaultFilterCommitMode;
  }
}

// A storage failure leaves the in-memory mode in charge; it never blocks the
// toggle or the commit that follows it.
export function saveFilterCommitMode(mode) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      filterCommitModeStorageKey,
      normalizeFilterCommitMode(mode),
    );
  } catch {
    // The mode is already set in memory; there is nothing else to do.
  }
}
