import { describe, expect, test } from "vitest";
import { applyNoteView, sortNotesBySort } from "./noteView.js";
import { dataColumns } from "./tableColumns.js";

function note(id, overrides = {}) {
  return {
    id,
    collection_id: 1,
    collection_order: 1,
    display_order: id,
    denomination: `NOTE-${id}`,
    catalog_number: "",
    issue_date: "",
    grading_company: "",
    grade: "",
    serial: "",
    tags: [],
    ...overrides,
  };
}

describe("applyNoteView", () => {
  test("scopes to one collection before filtering", () => {
    const notes = [
      note(1, { collection_id: 1, denomination: "alpha" }),
      note(2, { collection_id: 2, denomination: "alpha" }),
      note(3, { collection_id: 2, denomination: "beta" }),
    ];

    const result = applyNoteView(notes, {
      collectionId: 2,
      conditions: [{ field: "denomination", negated: false, value: "alpha" }],
      searchColumns: dataColumns,
    });

    expect(result.map((entry) => entry.id)).toEqual([2]);
  });

  test("keeps letter-prefixed catalog numbers under the catalog filter", () => {
    const notes = [
      note(1, { catalog_number: "M1" }),
      note(2, { catalog_number: "M2" }),
      note(3, { catalog_number: "M10" }),
      note(4, { catalog_number: "MA" }),
      note(5, { catalog_number: "N1" }),
      note(6, { catalog_number: "22" }),
      note(7, { catalog_number: "220" }),
    ];

    const result = applyNoteView(notes, {
      conditions: [
        { field: "catalog_number", negated: false, value: "m" },
      ],
      searchColumns: dataColumns,
    });

    expect(result.map((entry) => entry.id)).toEqual([1, 2, 3, 4]);
  });

  test("still excludes a longer number under a numeric catalog filter", () => {
    const notes = [
      note(1, { catalog_number: "22" }),
      note(2, { catalog_number: "22a" }),
      note(3, { catalog_number: "220" }),
    ];

    const result = applyNoteView(notes, {
      conditions: [
        { field: "catalog_number", negated: false, value: "22" },
      ],
      searchColumns: dataColumns,
    });

    expect(result.map((entry) => entry.id)).toEqual([1, 2]);
  });

  test("keeps separator notation under the catalog filter", () => {
    const notes = [
      note(1, { catalog_number: "22" }),
      note(2, { catalog_number: "22-3" }),
      note(3, { catalog_number: "220" }),
    ];

    const result = applyNoteView(notes, {
      conditions: [
        { field: "catalog_number", negated: false, value: "22" },
      ],
      searchColumns: dataColumns,
    });

    expect(result.map((entry) => entry.id)).toEqual([1, 2]);
  });

  test("applies the filter chips before sorting", () => {
    const notes = [
      note(1, { denomination: "beta" }),
      note(2, { denomination: "alpha" }),
      note(3, { denomination: "alphabet" }),
    ];

    const result = applyNoteView(notes, {
      conditions: [{ field: "denomination", negated: false, value: "alpha" }],
      searchColumns: dataColumns,
      sortKey: "denomination",
      sortDirection: "asc",
    });

    expect(result.map((entry) => entry.denomination)).toEqual([
      "alpha",
      "alphabet",
    ]);
  });

  test("uses the collection order when asked for the collection sort", () => {
    const notes = [
      note(1, { collection_id: 2, collection_order: 2, display_order: 1 }),
      note(2, { collection_id: 1, collection_order: 1, display_order: 2 }),
      note(3, { collection_id: 1, collection_order: 1, display_order: 1 }),
    ];

    const result = applyNoteView(notes, {
      collectionSortKey: "collection",
      sortKey: "collection",
    });

    expect(result.map((entry) => entry.id)).toEqual([3, 2, 1]);
  });

  test("falls back to the collection order when no sort is chosen", () => {
    const notes = [
      note(1, { collection_order: 2 }),
      note(2, { collection_order: 1 }),
    ];

    const result = applyNoteView(notes, {
      collectionSortKey: "collection",
      sortKey: null,
    });

    expect(result.map((entry) => entry.id)).toEqual([2, 1]);
  });

  test("sorts by a field when the collection sort is not selected", () => {
    const notes = [
      note(1, { collection_order: 2, denomination: "zeta" }),
      note(2, { collection_order: 1, denomination: "alpha" }),
    ];

    const result = applyNoteView(notes, {
      collectionSortKey: "collection",
      sortKey: "denomination",
      sortDirection: "asc",
    });

    expect(result.map((entry) => entry.id)).toEqual([2, 1]);
  });
});

describe("sortNotesBySort", () => {
  test("reads each note's sort text and value once", () => {
    let reads = 0;
    const notes = Array.from({ length: 100 }, (_, index) => {
      const entry = note(index + 1);

      Object.defineProperty(entry, "denomination", {
        configurable: true,
        enumerable: true,
        get() {
          reads += 1;
          return `NOTE-${100 - index}`;
        },
      });

      return entry;
    });

    sortNotesBySort(notes, "denomination", "asc");

    // The text and the column's parsed value are read once per note. A
    // comparator that reads them instead would run O(n log n) times.
    expect(reads).toBe(notes.length * 2);
  });
});
