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

import { getNotes } from "../lib/api.js";

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
  return Array.from(container.querySelectorAll("tbody tr.table-row-link"));
}

function rowFor(container, denomination) {
  return rowsInOrder(container).find((row) =>
    row.textContent.includes(denomination),
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

describe("NotesTable selection tint", () => {
  test("ticking a row tints it and unticking clears the tint", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    expect(rowFor(container, "AAAA")).not.toHaveClass(
      "table-row-link--selected",
    );

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await waitFor(() => {
      expect(rowFor(container, "AAAA")).toHaveClass(
        "table-row-link--selected",
      );
    });
    expect(rowFor(container, "BBBB")).not.toHaveClass(
      "table-row-link--selected",
    );

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await waitFor(() => {
      expect(rowFor(container, "AAAA")).not.toHaveClass(
        "table-row-link--selected",
      );
    });
  });

  test("the keyboard cursor keeps its own highlight on a row that is not selected", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));

    const cursorRow = rowFor(container, "BBBB");
    await act(async () => {
      cursorRow.focus();
    });

    expect(rowFor(container, "BBBB")).toHaveClass("table-row-link--active");
    expect(rowFor(container, "BBBB")).not.toHaveClass(
      "table-row-link--selected",
    );
    expect(rowFor(container, "AAAA")).toHaveClass("table-row-link--selected");
    expect(rowFor(container, "AAAA")).not.toHaveClass("table-row-link--active");
  });
});
