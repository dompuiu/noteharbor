import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
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

function note(id, overrides = {}) {
  return {
    id,
    display_order: id,
    denomination: `NOTE-${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...overrides,
  };
}

const collectionNotes = [
  note(1, {
    denomination: "AAAA",
    catalog_number: "Fr. 2300",
    issue_date: "1928",
    grading_company: "PMG",
    grade: "65",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "BBBB",
    catalog_number: "Fr. 500",
    issue_date: "1934",
    grading_company: "PCGS",
    grade: "64",
    serial: "SER-2",
  }),
];

function tableScreen(collectionId = 1) {
  return (
    <MemoryRouter
      initialEntries={[`/catalog/collections/${collectionId}/view`]}
    >
      <NotesTable
        collection={{ id: collectionId, is_default: 1, name: "Test" }}
        collectionId={collectionId}
        collections={[
          { id: 1, is_default: 1, name: "Test" },
          { id: 2, is_default: 0, name: "Second" },
        ]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>
  );
}

function renderTable(collectionId = 1) {
  return render(tableScreen(collectionId));
}

function columnsButton() {
  return screen.findByRole("button", { name: "Columns" });
}

async function openPicker() {
  const user = userEvent.setup();
  await user.click(await columnsButton());
  const dialog = await screen.findByRole("dialog", {
    name: "Visible columns",
  });
  return { user, dialog };
}

function columnCheckbox(name) {
  return screen.getByRole("checkbox", { name });
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
  getNotes.mockResolvedValue({ notes: collectionNotes });
});

describe("NotesTable columns", () => {
  test("the Columns control opens the hideable columns as checkboxes", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const button = await columnsButton();
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");

    const { user, dialog } = await openPicker();

    expect(button).toHaveAttribute("aria-expanded", "true");
    for (const name of [
      "#",
      "Denomination",
      "Date",
      "Company",
      "Grade",
      "Serial",
      "Tags",
    ]) {
      expect(within(dialog).getByRole("checkbox", { name })).toBeChecked();
    }

    // Permanent columns are not choices at all.
    for (const name of [
      "Catalog #",
      "FRONT",
      "ACTIONS",
      "Select all visible rows",
    ]) {
      expect(
        within(dialog).queryByRole("checkbox", { name }),
      ).not.toBeInTheDocument();
    }

    await user.click(button);
    expect(
      screen.queryByRole("dialog", { name: "Visible columns" }),
    ).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("unchecking a column hides its header and every cell", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const { user } = await openPicker();

    await user.click(columnCheckbox("Serial"));

    expect(columnCheckbox("Serial")).not.toBeChecked();
    expect(
      screen.queryByRole("columnheader", { name: "SERIAL" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SER-1")).not.toBeInTheDocument();
    expect(screen.queryByText("SER-2")).not.toBeInTheDocument();
    expect(screen.getByText("AAAA")).toBeInTheDocument();

    await user.click(columnCheckbox("Serial"));

    expect(columnCheckbox("Serial")).toBeChecked();
    expect(
      await screen.findByRole("columnheader", { name: "SERIAL" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SER-1")).toBeInTheDocument();
  });

  test("the last visible data column cannot be hidden", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const { user } = await openPicker();

    for (const name of ["Denomination", "Date", "Company", "Grade", "Serial"]) {
      await user.click(columnCheckbox(name));
    }

    expect(columnCheckbox("Tags")).toBeDisabled();
    await user.click(columnCheckbox("Tags"));
    expect(columnCheckbox("Tags")).toBeChecked();
    expect(
      screen.getByRole("columnheader", { name: "TAGS" }),
    ).toBeInTheDocument();

    await user.click(columnCheckbox("Denomination"));

    expect(columnCheckbox("Tags")).not.toBeDisabled();
  });

  test("permanent columns stay rendered when every hideable column is hidden", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const { user } = await openPicker();

    for (const name of [
      "#",
      "Denomination",
      "Date",
      "Company",
      "Grade",
      "Serial",
    ]) {
      await user.click(columnCheckbox(name));
    }

    expect(
      screen.getByRole("columnheader", { name: "CATALOG #" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "FRONT" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "ACTIONS" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select all visible rows" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Fr. 2300")).toBeInTheDocument();
  });

  test("hiding a filtered column clears its filter and chip", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.type(await screen.findByLabelText("Filter Company"), "PMG");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Filters (1 active)" }),
    ).toBeInTheDocument();

    await user.click(await columnsButton());
    const dialog = await screen.findByRole("dialog", {
      name: "Visible columns",
    });
    await user.click(within(dialog).getByRole("checkbox", { name: "Company" }));

    expect(screen.queryByText("Company: PMG")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Filters \(/ }),
    ).not.toBeInTheDocument();
    await screen.findByText("BBBB");
  });

  test("hiding the sorted column returns the table to # ascending", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "COMPANY" }));
    expect(screen.getByRole("button", { name: "#" })).toBeInTheDocument();

    await user.click(await columnsButton());
    const dialog = await screen.findByRole("dialog", {
      name: "Visible columns",
    });
    await user.click(within(dialog).getByRole("checkbox", { name: "Company" }));

    const idHeader = screen.getByRole("columnheader", { name: /^#/ });
    expect(idHeader).toHaveAttribute("aria-sort", "ascending");
    expect(idHeader.querySelector(".sort-chevron")).not.toBeNull();
  });

  test("hiding the # column moves the sort to a rendered sortable column", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();

    await user.click(await columnsButton());
    const dialog = await screen.findByRole("dialog", {
      name: "Visible columns",
    });
    await user.click(within(dialog).getByRole("checkbox", { name: "#" }));

    expect(
      screen.queryByRole("columnheader", { name: /^#/ }),
    ).not.toBeInTheDocument();

    // The old sort key is no longer rendered, so the table falls back to the
    // first visible sortable column instead of sorting by a hidden one.
    const catalogHeader = screen.getByRole("columnheader", {
      name: "CATALOG #",
    });
    expect(catalogHeader).toHaveAttribute("aria-sort", "ascending");
    expect(catalogHeader.querySelector(".sort-chevron")).not.toBeNull();
  });

  test("the choice is saved per collection and survives a reload", async () => {
    const { unmount } = renderTable(1);

    await screen.findByText("AAAA");
    const { user } = await openPicker();
    await user.click(columnCheckbox("Serial"));

    await waitFor(() => {
      const savedColumns = JSON.parse(
        window.localStorage.getItem("noteharbor.notesTableColumns.1"),
      );
      expect(savedColumns).not.toContain("serial");
    });

    // The global view state keeps its existing shape: columns do not join it.
    const savedState = JSON.parse(
      window.localStorage.getItem("noteharbor.notesTableState"),
    );
    expect(Object.keys(savedState).sort()).toEqual([
      "filters",
      "selectedIds",
      "sortDirection",
      "sortKey",
    ]);

    unmount();
    renderTable(1);

    await screen.findByText("AAAA");
    expect(
      screen.queryByRole("columnheader", { name: "SERIAL" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SER-1")).not.toBeInTheDocument();
  });

  test("each collection keeps its own column choice", async () => {
    const { rerender } = renderTable(1);

    await screen.findByText("AAAA");
    const { user } = await openPicker();
    await user.click(columnCheckbox("Serial"));

    rerender(tableScreen(2));

    expect(
      await screen.findByRole("columnheader", { name: "SERIAL" }),
    ).toBeInTheDocument();

    await user.click(await columnsButton());
    await screen.findByRole("dialog", { name: "Visible columns" });
    await user.click(columnCheckbox("Date"));
    await waitFor(() => {
      const savedColumns = JSON.parse(
        window.localStorage.getItem("noteharbor.notesTableColumns.2"),
      );
      expect(savedColumns).not.toContain("issue_date");
      expect(savedColumns).toContain("serial");
    });

    rerender(tableScreen(1));

    await waitFor(() => {
      expect(
        screen.queryByRole("columnheader", { name: "SERIAL" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("columnheader", { name: "DATE" }),
    ).toBeInTheDocument();
  });

  test("Escape closes the picker and returns focus to Columns", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();
    const button = await columnsButton();
    await user.click(button);
    const dialog = await screen.findByRole("dialog", {
      name: "Visible columns",
    });

    expect(within(dialog).getAllByRole("checkbox")[0]).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "Visible columns" }),
    ).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  test("Reset view restores every column", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const { user } = await openPicker();
    await user.click(columnCheckbox("Serial"));
    await user.keyboard("{Escape}");

    const reset = await screen.findByRole("button", {
      name: "Reset view",
    });
    await user.click(reset);

    expect(
      await screen.findByRole("columnheader", { name: "SERIAL" }),
    ).toBeInTheDocument();
    expect(screen.getByText("SER-1")).toBeInTheDocument();
  });
});
