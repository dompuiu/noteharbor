import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useTableFind } from "./useTableFind.js";
import { dataColumns } from "./tableColumns.js";

function note(id, overrides = {}) {
  return {
    id,
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

function shortcut(overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: "",
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...overrides,
  };
}

function setup(overrides = {}) {
  const rows = [
    note(1, { denomination: "alpha" }),
    note(2, { denomination: "beta" }),
    note(3, { denomination: "alphabet" }),
  ];
  const onCloseFocus = vi.fn();
  const onRevealMatch = vi.fn();
  const onSearchAll = vi.fn();
  const props = {
    allRows: rows,
    hasActiveFilters: false,
    onCloseFocus,
    onRevealMatch,
    onSearchAll,
    rows,
    searchColumns: dataColumns,
    ...overrides,
  };
  const view = renderHook((next) => useTableFind(next), {
    initialProps: props,
  });
  const input = document.createElement("input");

  document.body.appendChild(input);
  view.result.current.inputRef.current = input;

  return {
    ...view,
    input,
    onCloseFocus,
    onRevealMatch,
    onSearchAll,
    props,
  };
}

describe("useTableFind", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("opens, searches the painted rows and marks the matches", async () => {
    const { result, input } = setup();

    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    await waitFor(() => expect(input).toHaveFocus());

    act(() => result.current.setQuery("alpha"));

    await waitFor(() =>
      expect(result.current.matches.map((entry) => entry.id)).toEqual([1, 3]),
    );
    expect(result.current.currentMatchId).toBe(1);
    expect(result.current.marksByNoteId.get(1)).toEqual({
      denomination: ["alpha"],
    });
    expect(result.current.barProps.matchCount).toBe(2);
    expect(result.current.status).toBe(" · Find 1 of 2");
  });

  test("steps through matches with wrap-around", async () => {
    const { result } = setup();

    act(() => result.current.open());
    act(() => result.current.setQuery("alpha"));
    await waitFor(() => expect(result.current.matches).toHaveLength(2));

    act(() => result.current.step(1));
    expect(result.current.currentMatchId).toBe(3);

    act(() => result.current.step(1));
    expect(result.current.currentMatchId).toBe(1);
  });

  test("falls back to the first match when the current one disappears", async () => {
    const { result, rerender, props } = setup();

    act(() => result.current.open());
    act(() => result.current.setQuery("alpha"));
    await waitFor(() => expect(result.current.currentMatchId).toBe(1));

    const nextRows = [note(3, { denomination: "alphabet" })];

    rerender({ ...props, allRows: nextRows, rows: nextRows });

    await waitFor(() => expect(result.current.currentMatchId).toBe(3));
  });

  test("close clears the query and hands the match id to the screen", async () => {
    const { result, onCloseFocus } = setup();

    act(() => result.current.open());
    act(() => result.current.setQuery("beta"));
    await waitFor(() => expect(result.current.currentMatchId).toBe(2));

    act(() => result.current.close());

    expect(onCloseFocus).toHaveBeenCalledWith(2);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("");
    expect(result.current.matches).toEqual([]);
  });

  test("offers Search all only when the wider scope has a match", async () => {
    const rows = [note(2, { denomination: "beta" })];
    const allRows = [...rows, note(1, { denomination: "alpha" })];
    const { result, input, onSearchAll } = setup({
      allRows,
      hasActiveFilters: true,
      rows,
    });

    act(() => result.current.open());
    act(() => result.current.setQuery("alpha"));
    await waitFor(() => expect(result.current.canSearchAll).toBe(true));

    act(() => result.current.searchAll());

    expect(onSearchAll).toHaveBeenCalledTimes(1);
    expect(result.current.currentMatchId).toBe(null);
    expect(input).toHaveFocus();
  });

  test("does not offer Search all for a query nothing can match", async () => {
    const rows = [note(2, { denomination: "beta" })];
    const { result } = setup({ hasActiveFilters: true, rows });

    act(() => result.current.open());
    act(() => result.current.setQuery("nonsense"));

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.canSearchAll).toBe(false);
  });

  test("handles Ctrl+F, F3 and Escape", async () => {
    const { result, onCloseFocus } = setup();
    const openEvent = shortcut({ ctrlKey: true, key: "f" });
    let handled = false;

    act(() => {
      handled = result.current.handleShortcut(openEvent);
    });
    expect(handled).toBe(true);
    expect(openEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.setQuery("alpha"));
    await waitFor(() => expect(result.current.currentMatchId).toBe(1));

    const nextEvent = shortcut({ key: "F3" });

    act(() => {
      handled = result.current.handleShortcut(nextEvent);
    });
    expect(handled).toBe(true);
    expect(nextEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.currentMatchId).toBe(3);

    const closeEvent = shortcut({ key: "Escape" });

    act(() => {
      handled = result.current.handleShortcut(closeEvent);
    });
    expect(handled).toBe(true);
    expect(closeEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);
    expect(onCloseFocus).toHaveBeenCalledWith(3);
  });

  test("ignores keys it does not own", () => {
    const { result } = setup();

    expect(result.current.handleShortcut(shortcut({ key: "a" }))).toBe(false);
    expect(result.current.handleShortcut(shortcut({ key: "F3" }))).toBe(false);
    expect(result.current.handleShortcut(shortcut({ key: "Escape" }))).toBe(
      false,
    );
  });

  test("resets when the reset key changes", async () => {
    const { result, rerender, props } = setup({ resetKey: 1 });

    act(() => result.current.open());
    act(() => result.current.setQuery("alpha"));
    await waitFor(() => expect(result.current.matches).toHaveLength(2));

    rerender({ ...props, resetKey: 2 });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.query).toBe("");
  });
});
