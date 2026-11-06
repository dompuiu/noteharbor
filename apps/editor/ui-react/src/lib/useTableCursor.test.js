import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const virtualizerCalls = { scrollToIndex: vi.fn() };

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        end: (index + 1) * 45,
        index,
        key: index,
        size: 45,
        start: index * 45,
      })),
    getTotalSize: () => count * 45,
    measureElement: () => {},
    scrollToIndex: (...args) => virtualizerCalls.scrollToIndex(...args),
    scrollToOffset: () => {},
  }),
}));

import { useTableCursor } from "./useTableCursor.js";

function note(id) {
  return { id };
}

function rowElement() {
  const row = document.createElement("tr");

  row.tabIndex = -1;
  document.body.appendChild(row);
  return row;
}

describe("useTableCursor", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    virtualizerCalls.scrollToIndex.mockClear();
  });

  test("focuses a mounted row and paints the cursor", () => {
    const rows = [note(1), note(2)];
    const { result } = renderHook(() => useTableCursor({ rows }));
    const row = rowElement();

    act(() => result.current.registerRowElement(1, row));
    act(() => result.current.requestFocus(1));

    expect(document.activeElement).toBe(row);
    expect(result.current.activeNoteId).toBe(1);
    expect(result.current.focusedRowIdRef.current).toBe(1);
  });

  test("queues focus for a row that has not mounted yet", () => {
    const rows = [note(1), note(2)];
    const after = vi.fn();
    const { result } = renderHook(() => useTableCursor({ rows }));

    act(() => result.current.requestFocus(2, { after }));

    expect(result.current.activeNoteId).toBe(2);
    expect(virtualizerCalls.scrollToIndex).toHaveBeenCalledWith(1, {
      align: "auto",
    });

    const row = rowElement();

    act(() => result.current.registerRowElement(2, row));

    expect(document.activeElement).toBe(row);
    expect(after).toHaveBeenCalledTimes(1);
  });

  test("moves the cursor and hands off before the first row", () => {
    const rows = [note(1), note(2), note(3)];
    const { result } = renderHook(() => useTableCursor({ rows }));
    const first = rowElement();
    const second = rowElement();

    act(() => {
      result.current.registerRowElement(1, first);
      result.current.registerRowElement(2, second);
    });
    act(() => result.current.requestFocus(1));

    let targetId;

    act(() => {
      targetId = result.current.moveRowFocus(1);
    });

    expect(targetId).toBe(2);
    expect(result.current.activeNoteId).toBe(2);

    const onBeforeFirst = vi.fn();

    act(() => result.current.requestFocus(1));
    act(() => {
      targetId = result.current.moveRowFocus(-1, { onBeforeFirst });
    });

    expect(targetId).toBe(null);
    expect(onBeforeFirst).toHaveBeenCalledTimes(1);
    expect(result.current.activeNoteId).toBe(null);
  });

  test("pages from the focused row and pins the target to the top", () => {
    const rows = Array.from({ length: 10 }, (_, index) => note(index + 1));
    const { result } = renderHook(() => useTableCursor({ rows }));
    const scroller = document.createElement("div");

    Object.defineProperty(scroller, "clientHeight", { value: 200 });
    result.current.scrollRef.current = scroller;

    act(() => result.current.requestFocus(1));

    let targetId;

    act(() => {
      targetId = result.current.pageRows(1);
    });

    expect(targetId).toBe(5);
    expect(virtualizerCalls.scrollToIndex).toHaveBeenLastCalledWith(4, {
      align: "start",
    });
  });

  test("reveals an off-screen row by centering it", () => {
    const rows = Array.from({ length: 10 }, (_, index) => note(index + 1));
    const { result } = renderHook(() => useTableCursor({ rows }));

    act(() => result.current.revealRow(8));

    expect(virtualizerCalls.scrollToIndex).toHaveBeenCalledWith(7, {
      align: "center",
    });
  });

  test("marks and clears the cursor", () => {
    const rows = [note(1)];
    const { result } = renderHook(() => useTableCursor({ rows }));

    act(() => result.current.markActiveNote(1));
    expect(result.current.activeNoteId).toBe(1);
    expect(result.current.lastActiveNoteIdRef.current).toBe(1);

    act(() => result.current.clearRowCursor());
    expect(result.current.activeNoteId).toBe(null);
    expect(result.current.focusedRowIdRef.current).toBe(null);
  });
});
