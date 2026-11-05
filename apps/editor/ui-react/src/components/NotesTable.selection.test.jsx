import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

import { deleteNote, getNotes } from "../lib/api.js";

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
  deleteNote.mockResolvedValue({});
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

describe("NotesTable bulk bar", () => {
  test("is absent until a row is selected", async () => {
    renderTable();
    await screen.findByText("AAAA");

    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
  });

  test("a saved selection is not restored on a reload", async () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        selectedIds: [1],
        sortKey: "id",
        sortDirection: "asc",
        visibleColumnKeys: ["id", "denomination", "issue_date", "serial"],
      }),
    );

    renderTable();
    await screen.findByText("AAAA");

    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select AAAA" }),
    ).not.toBeChecked();
  });

  test("shows the count, keeps gapped moves disabled, and puts Delete before the clear icon", async () => {
    renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select CCCC" }));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    expect(within(bar).getByText("2 selected")).toBeInTheDocument();

    // AAAA and CCCC are gapped, so the bulk bar refuses both moves.
    expect(
      within(bar).getByRole("button", { name: "Move 2 selected notes up" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(bar).getByRole("button", { name: "Move 2 selected notes down" }),
    ).toHaveAttribute("aria-disabled", "true");

    const deleteButton = within(bar).getByRole("button", { name: "Delete" });
    const clearButton = within(bar).getByRole("button", {
      name: "Clear selection",
    });
    expect(deleteButton).toHaveTextContent("Delete");
    expect(deleteButton).not.toHaveAttribute("aria-label");
    expect(deleteButton).toBeEnabled();
    expect(clearButton).toHaveAccessibleName("Clear selection");
    expect(clearButton).toBeEnabled();
  });

  test("reports the selected count in the footer summary, not above the table", async () => {
    renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select CCCC" }));

    expect(
      screen.getByText(
        "Showing 3 of 3 notes · sorted by # ascending · 2 selected",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/notes in the current view/),
    ).not.toBeInTheDocument();
  });

  test("Delete asks for confirmation and deletes every selected note", async () => {
    renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select CCCC" }));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    await user.click(within(bar).getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Delete 2 selected notes?"),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteNote).toHaveBeenCalledWith(1, 1);
      expect(deleteNote).toHaveBeenCalledWith(3, 1);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Selection actions" }),
      ).not.toBeInTheDocument();
    });
  });

  test("Clear empties the selection and removes the bar", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select BBBB" }));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    await user.click(
      within(bar).getByRole("button", { name: "Clear selection" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Selection actions" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox", { name: "Select AAAA" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select BBBB" })).not.toBeChecked();
    expect(
      rowsInOrder(container).some((row) =>
        row.classList.contains("table-row-link--selected"),
      ),
    ).toBe(false);
  });

  test("pressing `b` keeps the selection", async () => {
    renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select BBBB" }));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const deleteButton = within(bar).getByRole("button", { name: "Delete" });
    deleteButton.focus();

    await user.keyboard("{b}");

    expect(
      screen.getByRole("region", { name: "Selection actions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select AAAA" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select BBBB" })).toBeChecked();
  });

  test("the bar leaves the last row in the document", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));

    expect(
      screen.getByRole("region", { name: "Selection actions" }),
    ).toBeInTheDocument();
    expect(rowFor(container, "CCCC")).toBeInTheDocument();
    expect(rowFor(container, "CCCC")).toHaveTextContent("CCCC");
  });
});

describe("NotesTable select-all", () => {
  test("reports indeterminate when only some visible rows are selected", async () => {
    renderTable();
    const user = userEvent.setup();
    await screen.findByText("AAAA");

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all visible rows",
    });
    expect(selectAll).not.toBeChecked();
    expect(selectAll.indeterminate).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));

    expect(selectAll).not.toBeChecked();
    expect(selectAll.indeterminate).toBe(true);

    await user.click(selectAll);

    await waitFor(() => {
      expect(selectAll).toBeChecked();
    });
    expect(selectAll.indeterminate).toBe(false);
  });
});
