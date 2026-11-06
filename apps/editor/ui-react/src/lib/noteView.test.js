import { describe, expect, test } from "vitest";
import { applyNoteView } from "./noteView.js";
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
