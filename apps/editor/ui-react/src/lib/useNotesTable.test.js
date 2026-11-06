import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => [],
    getTotalSize: () => count * 45,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

vi.mock("./noteRowModel.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildNoteRowModel: vi.fn(actual.buildNoteRowModel) };
});

import { buildNoteRowModel } from "./noteRowModel.js";
import { dataColumns, tableColumns } from "./tableColumns.js";
import { useNotesTable } from "./useNotesTable.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id) {
  return {
    id,
    display_order: id,
    denomination: `NOTE-${id}`,
    images: [],
    tags: [],
  };
}

function notes(count) {
  return Array.from({ length: count }, (_, index) => note(index + 1));
}

function renderTable(rows) {
  return renderHook(() =>
    useNotesTable({
      allRows: rows,
      columns: tableColumns,
      conditions: [],
      hasActiveFilters: false,
      rows,
      searchColumns: dataColumns,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

describe("useNotesTable row models", () => {
  test("builds a model only when a row asks for it, then reuses it", () => {
    const rows = notes(500);
    const { result } = renderTable(rows);

    // Nothing has painted a row yet, so nothing has been built.
    expect(buildNoteRowModel).not.toHaveBeenCalled();

    const first = result.current.rowModelsByNoteId.get(1);

    expect(first).toBeDefined();
    expect(buildNoteRowModel).toHaveBeenCalledTimes(1);

    // A row that stays in the window gets its model back by identity, so its
    // memoized component does not re-render.
    expect(result.current.rowModelsByNoteId.get(1)).toBe(first);
    expect(buildNoteRowModel).toHaveBeenCalledTimes(1);

    result.current.rowModelsByNoteId.get(2);
    expect(buildNoteRowModel).toHaveBeenCalledTimes(2);
    expect(buildNoteRowModel.mock.calls.length).toBeLessThan(rows.length);
  });

  test("returns no model for a note outside the painted list", () => {
    const rows = notes(2);
    const { result } = renderTable(rows);

    expect(result.current.rowModelsByNoteId.get(999)).toBeUndefined();
    expect(buildNoteRowModel).not.toHaveBeenCalled();
  });
});
