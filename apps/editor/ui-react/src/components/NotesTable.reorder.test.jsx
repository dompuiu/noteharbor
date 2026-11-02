import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 43,
        start: index * 43,
        end: (index + 1) * 43,
      })),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import {
  getNotes,
  reorderNotes,
} from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, denomination) {
  return {
    id,
    display_order: id,
    denomination,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
  };
}

function dragEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function makeDataTransfer() {
  return {
    effectAllowed: "",
    setData: vi.fn(),
    setDragImage: vi.fn(),
    getData: vi.fn(() => ""),
  };
}

function bounds(top, bottom) {
  return {
    width: 1000,
    height: bottom - top,
    top,
    bottom,
    left: 0,
    right: 1000,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function renderTable() {
  return render(
    <MemoryRouter>
      <NotesTable
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 600,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  getNotes.mockResolvedValue({
    notes: [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")],
  });
  reorderNotes.mockResolvedValue({ notes: [] });
});

function rowFor(container, denomination) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  ).find((row) => row.textContent.includes(denomination));
}

describe("NotesTable row reordering", () => {
  test("tabbing from a row skips the pointer-only drag handle", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByLabelText("Reorder AAAA");
    const row = rowFor(container, "AAAA");
    act(() => row.focus());
    await user.tab();

    // The handle sits first in the row, so Tab must step over it straight to
    // the selection checkbox; keyboard focus never lands on a control the
    // keys cannot operate.
    expect(screen.getByLabelText("Select AAAA")).toHaveFocus();
  });

  test("hovering the gap between rows keeps the drop placeholder steady", async () => {
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    // Hover the lower half of the target row: the placeholder should be
    // inserted into the gap right below it.
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    const placeholder = container.querySelector(
      ".table-drop-placeholder-row",
    );
    expect(placeholder).not.toBeNull();

    // The placeholder now sits under the pointer. Leaving the row for the
    // placeholder must NOT clear the target, otherwise the placeholder
    // unmounts and remounts in a loop (the flicker this fixes).
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragleave", {
          clientY: 400,
          dataTransfer,
          relatedTarget: placeholder,
        }),
      );
    });

    expect(
      container.querySelector(".table-drop-placeholder-row"),
    ).not.toBeNull();

    // Releasing over the placeholder still commits the reorder.
    await act(async () => {
      placeholder.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1], 1);
    });
  });

  test("a drag over the filter rail leaves the rows where they are", async () => {
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const shell = container.querySelector(".table-shell");
    const scroller = container.querySelector(".table-scroll-x");

    // The rail is 48px tall, so the scrollport starts that far below the
    // card's top edge. This is the geometry that used to make the rail a
    // scroll hot zone.
    HTMLElement.prototype.getBoundingClientRect.mockImplementation(
      function boundsFor() {
        if (this === shell) {
          return bounds(100, 700);
        }
        if (this === scroller) {
          return bounds(148, 700);
        }
        return bounds(0, 43);
      },
    );

    scroller.scrollTop = 100;
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    // The pointer is in the rail's band: inside the old top hot zone but
    // above the rows, so nothing should move.
    await act(async () => {
      shell.dispatchEvent(dragEvent("dragover", { clientY: 120, dataTransfer }));
    });
    expect(scroller.scrollTop).toBe(100);

    // A drag just inside the scrollport's own top edge still scrolls.
    await act(async () => {
      shell.dispatchEvent(dragEvent("dragover", { clientY: 160, dataTransfer }));
    });
    expect(scroller.scrollTop).toBeLessThan(100);

    // Cancel the drag so the preview clone does not outlive the test.
    await act(async () => {
      handle.dispatchEvent(dragEvent("dragend", { dataTransfer }));
    });
  });

  test("a failed reorder restores the old order and says why", async () => {
    reorderNotes.mockRejectedValue(new Error("Order could not be saved"));
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Order could not be saved")).toBeInTheDocument();
    });

    // The optimistic order is rolled back, so the collector never keeps a
    // position the server rejected.
    const rows = Array.from(
      container.querySelectorAll("tbody tr.table-row-link"),
    ).map((row) => row.textContent);

    expect(rows[0]).toContain("AAAA");
    expect(rows[1]).toContain("BBBB");
    expect(rows[2]).toContain("CCCC");
  });

  test("dropping a row moves the keyboard cursor to its new place", async () => {
    // The server echoes the reordered notes back; the rows stay mounted.
    reorderNotes.mockResolvedValue({
      notes: [note(2, "BBBB"), note(3, "CCCC"), note(1, "AAAA")],
    });
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Reorder AAAA");
    const targetRow = rowFor(container, "CCCC");
    expect(targetRow).toBeTruthy();

    const dataTransfer = makeDataTransfer();

    // Real drags start with a mouse press on the handle, which must not
    // select the row by itself — selection happens on drop below.
    await act(async () => {
      handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    await act(async () => {
      handle.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });

    await act(async () => {
      targetRow.dispatchEvent(
        dragEvent("drop", { clientY: 400, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 3, 1], 1);
    });

    const movedRow = rowFor(container, "AAAA");
    await waitFor(() => {
      expect(movedRow).toHaveFocus();
    });
    expect(movedRow).toHaveClass("table-row-link--active");
  });
});
