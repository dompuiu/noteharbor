import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  allNotesDefaultSortKey,
  allNotesTableStateStorageKey,
  defaultAllNotesTableState,
  defaultAllNotesVisibleColumnKeys,
  hydrateDesktopAllNotesTableState,
  loadAllNotesTableState,
  saveAllNotesTableState,
} from "./allNotesColumns.js";

function installBridge(overrides = {}) {
  window.noteHarborDesktop = {
    getTableStates: vi.fn().mockResolvedValue({}),
    setTableState: vi.fn().mockResolvedValue(null),
    removeTableState: vi.fn().mockResolvedValue(undefined),
    clearCollectionTableStates: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return window.noteHarborDesktop;
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.noteHarborDesktop;
});

describe("all notes table state", () => {
  test("defaults to collection order with every column visible", () => {
    expect(loadAllNotesTableState()).toEqual({
      sortKey: null,
      sortDirection: "asc",
      visibleColumnKeys: defaultAllNotesVisibleColumnKeys(),
    });
    expect(defaultAllNotesTableState()).toEqual(loadAllNotesTableState());
  });

  test("round-trips the sort and columns", () => {
    saveAllNotesTableState({
      sortKey: "issue_date",
      sortDirection: "asc",
      visibleColumnKeys: ["issue_date", "serial"],
    });

    expect(loadAllNotesTableState()).toEqual({
      sortKey: "issue_date",
      sortDirection: "asc",
      visibleColumnKeys: ["issue_date", "serial"],
    });
  });

  test("keeps the collection sort and drops a sort on a hidden column", () => {
    window.localStorage.setItem(
      allNotesTableStateStorageKey,
      JSON.stringify({
        sortKey: allNotesDefaultSortKey,
        sortDirection: "desc",
        visibleColumnKeys: ["issue_date"],
      }),
    );
    expect(loadAllNotesTableState()).toMatchObject({
      sortKey: allNotesDefaultSortKey,
      sortDirection: "desc",
    });

    window.localStorage.setItem(
      allNotesTableStateStorageKey,
      JSON.stringify({
        sortKey: "serial",
        sortDirection: "asc",
        visibleColumnKeys: ["issue_date"],
      }),
    );
    expect(loadAllNotesTableState().sortKey).toBeNull();
  });

  test("ignores an unknown sort key", () => {
    window.localStorage.setItem(
      allNotesTableStateStorageKey,
      JSON.stringify({
        sortKey: "not_a_column",
        sortDirection: "sideways",
        visibleColumnKeys: ["id", "catalog_number"],
      }),
    );

    expect(loadAllNotesTableState()).toMatchObject({
      sortKey: null,
      sortDirection: "asc",
    });
  });

  test("mirrors every save through the desktop bridge", () => {
    const bridge = installBridge();

    saveAllNotesTableState({
      sortKey: "issue_date",
      sortDirection: "desc",
      visibleColumnKeys: defaultAllNotesVisibleColumnKeys(),
    });

    expect(bridge.setTableState).toHaveBeenCalledWith(
      "allNotes",
      JSON.parse(window.localStorage.getItem(allNotesTableStateStorageKey)),
    );
  });

  test("hydrates the saved sort from the desktop bridge", async () => {
    installBridge({
      getTableStates: vi.fn().mockResolvedValue({
        allNotes: {
          sortKey: "issue_date",
          sortDirection: "asc",
          visibleColumnKeys: ["id", "catalog_number", "issue_date"],
        },
      }),
    });

    await hydrateDesktopAllNotesTableState();

    expect(loadAllNotesTableState()).toMatchObject({
      sortKey: "issue_date",
      sortDirection: "asc",
    });
  });

  test("a local value wins over the desktop copy", async () => {
    saveAllNotesTableState({
      sortKey: "grade",
      sortDirection: "desc",
      visibleColumnKeys: defaultAllNotesVisibleColumnKeys(),
    });
    installBridge({
      getTableStates: vi.fn().mockResolvedValue({
        allNotes: {
          sortKey: "issue_date",
          sortDirection: "asc",
          visibleColumnKeys: defaultAllNotesVisibleColumnKeys(),
        },
      }),
    });

    await hydrateDesktopAllNotesTableState();

    expect(loadAllNotesTableState().sortKey).toBe("grade");
  });
});
