import { beforeEach, describe, expect, test } from "vitest";
import {
  clearAllTableStates,
  clearLegacyTableState,
  defaultTableState,
  defaultVisibleColumnKeys,
  loadTableState,
  pruneTableStates,
  saveTableState,
  tableStateStorageKey,
} from "./notesTableState.js";
import { defaultSortKey } from "./tableColumns.js";

const collectionId = 7;
const storageKey = "noteharbor.notesTableState.7";

function savedState(overrides = {}) {
  return JSON.stringify({
    sortKey: "denomination",
    sortDirection: "desc",
    visibleColumnKeys: ["id", "denomination", "serial"],
    ...overrides,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("notes table state storage", () => {
  test("keys one payload per collection", () => {
    expect(tableStateStorageKey(7)).toBe(storageKey);
    expect(tableStateStorageKey(12)).toBe("noteharbor.notesTableState.12");
  });

  test("defaults to display order with every column visible", () => {
    expect(loadTableState(collectionId)).toEqual({
      sortKey: defaultSortKey,
      sortDirection: "asc",
      visibleColumnKeys: defaultVisibleColumnKeys(),
    });
  });

  test("round-trips sort and columns", () => {
    saveTableState(collectionId, {
      sortKey: "denomination",
      sortDirection: "desc",
      visibleColumnKeys: ["id", "denomination", "serial"],
    });

    expect(loadTableState(collectionId)).toEqual({
      sortKey: "denomination",
      sortDirection: "desc",
      visibleColumnKeys: ["id", "denomination", "serial"],
    });
  });

  test("ignores a sort key that no column sorts by", () => {
    window.localStorage.setItem(
      storageKey,
      savedState({ sortKey: "not_a_column" }),
    );

    expect(loadTableState(collectionId).sortKey).toBe(defaultSortKey);
  });

  test("normalises an unknown sort direction to ascending", () => {
    window.localStorage.setItem(
      storageKey,
      savedState({ sortDirection: "sideways" }),
    );

    expect(loadTableState(collectionId).sortDirection).toBe("asc");
  });

  test("drops column keys the picker cannot show", () => {
    window.localStorage.setItem(
      storageKey,
      savedState({
        visibleColumnKeys: ["id", "denomination", "not_a_column", "selection"],
      }),
    );

    expect(loadTableState(collectionId).visibleColumnKeys).toEqual([
      "id",
      "denomination",
    ]);
  });

  test("falls back to every column when none of the saved ones is a field", () => {
    window.localStorage.setItem(
      storageKey,
      savedState({ visibleColumnKeys: ["id"] }),
    );

    expect(loadTableState(collectionId).visibleColumnKeys).toEqual(
      defaultVisibleColumnKeys(),
    );
  });

  test("removes a corrupt payload instead of failing", () => {
    window.localStorage.setItem(storageKey, "{not json");

    expect(loadTableState(collectionId).sortKey).toBe(defaultSortKey);
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  test("keeps filters, query and selection out of the payload", () => {
    saveTableState(collectionId, {
      sortKey: "denomination",
      sortDirection: "desc",
      visibleColumnKeys: ["id", "denomination"],
    });

    const rawValue = window.localStorage.getItem(storageKey);

    expect(rawValue).not.toContain("filters");
    expect(rawValue).not.toContain("query");
    expect(rawValue).not.toContain("selectedIds");
  });

  test("does nothing without a saved collection id", () => {
    saveTableState(null, {
      sortKey: "denomination",
      sortDirection: "desc",
      visibleColumnKeys: ["id", "denomination"],
    });

    expect(window.localStorage.length).toBe(0);
    expect(loadTableState(null)).toEqual(defaultTableState());
  });

  test("prunes the saved state of a deleted collection", () => {
    saveTableState(1, defaultTableState());
    saveTableState(2, defaultTableState());
    window.localStorage.setItem(
      "noteharbor.lastVisitedRoute",
      "/catalog/collections/2/view",
    );

    pruneTableStates([1]);

    expect(window.localStorage.getItem(tableStateStorageKey(1))).not.toBeNull();
    expect(window.localStorage.getItem(tableStateStorageKey(2))).toBeNull();
    expect(
      window.localStorage.getItem("noteharbor.lastVisitedRoute"),
    ).not.toBeNull();
  });

  test("clears every saved table state for an import", () => {
    saveTableState(1, defaultTableState());
    saveTableState(2, defaultTableState());
    window.localStorage.setItem(
      "noteharbor.notesTableState",
      JSON.stringify({ filters: { denomination: "AAA" } }),
    );
    window.localStorage.setItem(
      "noteharbor.notesTableColumns.1",
      JSON.stringify(["id", "denomination"]),
    );
    window.localStorage.setItem("noteharbor.lastVisitedRoute", "/elsewhere");
    window.localStorage.setItem("noteharbor.showcasePhotoSize", "large");

    clearAllTableStates();

    expect(
      window.localStorage.getItem("noteharbor.lastVisitedRoute"),
    ).toBe("/elsewhere");
    expect(window.localStorage.getItem("noteharbor.showcasePhotoSize")).toBe(
      "large",
    );
  });

  test("sweeps the legacy global and per-collection keys", () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState",
      JSON.stringify({ filters: { denomination: "AAA" } }),
    );
    window.localStorage.setItem(
      "noteharbor.notesTableColumns.1",
      JSON.stringify(["id", "denomination"]),
    );
    window.localStorage.setItem(storageKey, savedState());

    clearLegacyTableState();

    expect(
      window.localStorage.getItem("noteharbor.notesTableState"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("noteharbor.notesTableColumns.1"),
    ).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBe(savedState());
  });
});
