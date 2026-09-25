import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getOperationStatus: vi.fn(),
  reorderNotes: vi.fn(),
  getScrapeStatus: vi.fn(),
  startScrape: vi.fn(),
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
  getOperationStatus,
  getScrapeStatus,
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
    scrape_status: "idle",
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

function renderTable() {
  return render(
    <MemoryRouter>
      <NotesTable
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
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
  getScrapeStatus.mockResolvedValue({ status: "idle", items: [] });
  getOperationStatus.mockResolvedValue({
    currentOperation: "idle",
    isBusy: false,
  });
  reorderNotes.mockResolvedValue({ notes: [] });
});

function rowFor(container, denomination) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  ).find((row) => row.textContent.includes(denomination));
}

describe("NotesTable row reordering", () => {
  test("hovering the gap between rows keeps the drop placeholder steady", async () => {
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Move AAAA");
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
});
