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

import { getNotes, reorderNotes } from "../lib/api.js";

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
  note(3, {
    denomination: "CCCC",
    catalog_number: "Fr. 2301",
    issue_date: "1935",
    grading_company: "PMG",
    grade: "66",
    serial: "SER-3",
  }),
];

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
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

function resetViewButton() {
  return screen.queryByRole("button", { name: "Reset view" });
}

async function openFilters(user) {
  await user.click(await screen.findByRole("button", { name: /^Filters/ }));
}

async function hideSerialColumn(user) {
  await user.click(await screen.findByRole("button", { name: "Columns" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Visible columns",
  });
  await user.click(within(dialog).getByRole("checkbox", { name: "Serial" }));
  await user.keyboard("{Escape}");
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

function rowFor(container, denomination) {
  return Array.from(
    container.querySelectorAll("tbody tr.table-row-link"),
  ).find((row) => row.textContent.includes(denomination));
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

describe("NotesTable chrome", () => {
  test("moves the reorder and shortcut instructions from the toolbar to the table foot", async () => {
    renderTable();

    await screen.findByText("AAAA");

    // The old toolbar sentence is gone.
    expect(
      screen.queryByText(/Drag rows from the handle/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Reordering is available only in the default/),
    ).not.toBeInTheDocument();

    const hint = screen.getByText(/Drag the handle to reorder/);
    expect(hint).toHaveTextContent("Drag the handle to reorder");
    expect(hint).toHaveTextContent("to browse");
    expect(hint).toHaveTextContent("shortcuts");
    expect(within(hint).getByText("?")).toBeInTheDocument();
  });

  test("the footer shows the view summary before the reorder hint", async () => {
    const { container } = renderTable();

    await screen.findByText("AAAA");

    const summary = screen.getByText(/^Showing /);
    expect(summary).toHaveTextContent(
      "Showing 3 of 3 notes · sorted by # ascending",
    );

    // The footer lives below the table card, not inside its border.
    const shell = container.querySelector(".table-shell");
    expect(shell).not.toBeNull();
    expect(shell.contains(summary)).toBe(false);

    const hint = screen.getByText(/Drag the handle to reorder/);
    expect(
      summary.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("the footer summary follows the filter and the sort", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("searchbox", { name: "Search notes" }),
      "AAAA",
    );
    await screen.findByText("Showing 1 of 3 notes · sorted by # ascending");

    await user.click(screen.getByRole("button", { name: "COMPANY" }));
    await screen.findByText(
      "Showing 1 of 3 notes · sorted by Company ascending",
    );
  });

  test("the shortcuts dialog still lists the full set", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();
    await user.keyboard("?");

    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });

    expect(
      within(dialog).getByText("Focus the search field"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByText(/Move focus between rows/).length,
    ).toBeGreaterThan(0);
    expect(
      within(dialog).getByText(/Pan the columns to reveal/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByText("Toggle this help").length,
    ).toBeGreaterThan(0);
  });

  test("Reset view stays hidden on a default view", async () => {
    renderTable();

    await screen.findByText("AAAA");

    expect(resetViewButton()).not.toBeInTheDocument();
  });

  test.each([
    [
      "a search query",
      async (user) => {
        await user.type(
          screen.getByRole("searchbox", { name: "Search notes" }),
          "SER",
        );
      },
    ],
    [
      "an active filter",
      async (user) => {
        await openFilters(user);
        await user.type(await screen.findByLabelText("Filter Company"), "PMG");
      },
    ],
    [
      "a non-default sort",
      async (user) => {
        await user.click(
          screen.getByRole("button", { name: "DENOMINATION" }),
        );
      },
    ],
    [
      "a selection",
      async (user) => {
        await user.click(
          screen.getByRole("checkbox", { name: "Select AAAA" }),
        );
      },
    ],
  ])("Reset view appears after %s", async (_label, change) => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();

    expect(resetViewButton()).not.toBeInTheDocument();
    await change(user);

    expect(
      await screen.findByRole("button", { name: "Reset view" }),
    ).toBeInTheDocument();
  });

  test("Reset view clears the query, filters, sort and selection but keeps the columns", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("searchbox", { name: "Search notes" }),
      "SER",
    );
    await openFilters(user);
    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    await user.click(screen.getByRole("button", { name: "DENOMINATION" }));
    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await hideSerialColumn(user);

    expect(
      screen.queryByRole("columnheader", { name: "SERIAL" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(
      screen.getByRole("searchbox", { name: "Search notes" }),
    ).toHaveValue("");
    expect(screen.queryByLabelText("Filter Company")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "DENOMINATION" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select AAAA" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
    // Columns are structure, not view state: Reset view leaves them alone.
    expect(
      screen.queryByRole("columnheader", { name: "SERIAL" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SER-1")).not.toBeInTheDocument();
    expect(resetViewButton()).not.toBeInTheDocument();
  });

  test("the footer surfaces the manual-order save while reordering", async () => {
    let resolveSave;
    reorderNotes.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { container } = renderTable();

    const handle = await screen.findByLabelText("Move AAAA");
    const targetRow = rowFor(container, "CCCC");
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

    expect(
      await screen.findByText("Saving manual order..."),
    ).toBeInTheDocument();

    await act(async () => {
      resolveSave({ notes: collectionNotes });
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Saving manual order..."),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Drag the handle to reorder/)).toBeInTheDocument();
  });
});
