import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
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

function rowsInOrder(container) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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
});

describe("NotesTable zebra striping", () => {
  test("odd visual positions carry the zebra class, even positions do not", async () => {
    const { container } = renderTable();

    await screen.findByLabelText("Move AAAA");

    const rows = rowsInOrder(container);
    expect(rows).toHaveLength(3);
    expect(rows[0].classList.contains("table-row-link--zebra")).toBe(false);
    expect(rows[1].classList.contains("table-row-link--zebra")).toBe(true);
    expect(rows[2].classList.contains("table-row-link--zebra")).toBe(false);
  });

  test("re-sorting re-stripes by visual position, not note identity", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();

    await screen.findByLabelText("Move AAAA");

    // Two clicks on Denomination: first selects the column (asc), second
    // flips to desc, reversing the visual order to CCCC, BBBB, AAAA.
    await user.click(screen.getByRole("button", { name: /DENOMINATION/ }));
    await user.click(screen.getByRole("button", { name: /DENOMINATION/ }));

    await waitFor(() => {
      const first = rowsInOrder(container)[0];
      expect(first.textContent).toContain("CCCC");
    });

    const rows = rowsInOrder(container);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("CCCC"),
      expect.stringContaining("BBBB"),
      expect.stringContaining("AAAA"),
    ]);
    // The CCCC row is now first (even position): no zebra despite having
    // been odd before the sort.
    expect(rows[0].classList.contains("table-row-link--zebra")).toBe(false);
    expect(rows[1].classList.contains("table-row-link--zebra")).toBe(true);
    expect(rows[2].classList.contains("table-row-link--zebra")).toBe(false);
  });

  test("spacer, empty, and drop-placeholder rows are never striped", async () => {
    const { container } = renderTable();

    await screen.findByLabelText("Move AAAA");

    const nonDataRows = Array.from(
      container.querySelectorAll(
        "tbody tr.table-spacer-row, tbody tr.table-empty-row, tbody tr.table-drop-placeholder-row",
      ),
    );
    expect(
      nonDataRows.every(
        (row) => !row.classList.contains("table-row-link--zebra"),
      ),
    ).toBe(true);
  });
});
