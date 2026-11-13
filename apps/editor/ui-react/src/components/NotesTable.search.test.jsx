import { MemoryRouter, useLocation } from "react-router-dom";
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
import { chooseFilterField, filterFieldButton } from "../test/filterBar.js";

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

function HashProbe() {
  const location = useLocation();
  return <output data-testid="hash">{location.hash}</output>;
}

const collectionOneNotes = [
  note(1, {
    denomination: "AAAA",
    catalog_number: "Fr. 2300",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "BBBB",
    catalog_number: "Fr. 500",
    serial: "SER-2",
  }),
  note(3, {
    denomination: "CCCC",
    catalog_number: "Fr. 2300",
    serial: "SER-3",
  }),
];

function tableProps(overrides = {}) {
  return {
    collection: { id: 1, is_default: 1, name: "Test" },
    collectionId: 1,
    collections: [
      { id: 1, is_default: 1, name: "Test" },
      { id: 2, is_default: 0, name: "Second" },
    ],
    collectionsError: "",
    loadingCollections: false,
    ...overrides,
  };
}

function renderTable(overrides = {}) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <HashProbe />
      <NotesTable {...tableProps(overrides)} />
    </MemoryRouter>,
  );
}

function filterInput(label = "Catalog") {
  return screen.getByRole("searchbox", { name: `Filter ${label}` });
}

async function searchAllFields(user, query) {
  await chooseFilterField(user, "All fields");
  await user.type(filterInput("All fields"), `${query}{Enter}`);
}

async function currentHash() {
  return screen.getByTestId("hash").textContent;
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
  getNotes.mockResolvedValue({ notes: collectionOneNotes });
});

describe("NotesTable search", () => {
  test("All fields finds the same rows for 2300 and Fr. 2300", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Edit All fields filter 2300" }),
    );
    const editor = screen.getByLabelText("Edit All fields filter");
    await user.clear(editor);
    await user.type(editor, "Fr. 2300{Enter}");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("All fields ANDs the words of one query", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300 CCCC");

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("All fields normalises denominations: 1000 finds $1,000", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "$1,000", catalog_number: "Fr. 1" }),
        note(2, { denomination: "$5", catalog_number: "Fr. 2" }),
      ],
    });
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("$1,000");
    await searchAllFields(user, "1000");

    await waitFor(() => {
      expect(screen.queryByText("$5")).not.toBeInTheDocument();
    });
    expect(screen.getByText("$1,000")).toBeInTheDocument();
  });

  test("Catalog scope matches a catalog prefix, not a substring", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");

    // "2300" is inside "Fr. 2300" but the catalog prefix is "fr. 2300".
    await user.type(filterInput("Catalog"), "2300{Enter}");
    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear all" }));
    await user.type(filterInput("Catalog"), "Fr. 2300{Enter}");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("matched text is marked in the cells", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    const marks = await screen.findAllByText("2300", { selector: "mark" });
    expect(marks.length).toBeGreaterThan(0);
  });

  test("the / key focuses the filter field and the dialog says so", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    const row = within(dialog)
      .getByText("Focus the filter field")
      .closest("li");
    expect(
      Array.from(row.querySelectorAll("kbd"), (key) => key.textContent),
    ).toEqual(["/"]);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument();
    });

    await user.keyboard("/");

    expect(filterInput("Catalog")).toHaveFocus();
  });

  test("Escape inside the field lands on the first row without clearing the draft", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    const input = filterInput("Catalog");
    await user.type(input, "2300");
    expect(input).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(input).not.toHaveFocus();
    expect(input).toHaveValue("2300");
    expect(document.querySelector("tbody tr.table-row-link")).toHaveFocus();
  });

  test("the count sentence follows the chips", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Showing 3 of 3 notes · sorted by # ascending");

    await searchAllFields(user, "2300");

    expect(
      await screen.findByText("Showing 2 of 3 notes · sorted by # ascending"),
    ).toBeInTheDocument();
  });

  test("two fields AND together", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    await chooseFilterField(user, "Denomination");
    await user.type(
      await screen.findByRole("searchbox", { name: "Filter Denomination" }),
      "AAAA{Enter}",
    );

    const table = screen.getByRole("table");
    await waitFor(() => {
      expect(within(table).queryByText("CCCC")).not.toBeInTheDocument();
    });
    expect(within(table).getByText("AAAA")).toBeInTheDocument();
    expect(within(table).queryByText("BBBB")).not.toBeInTheDocument();
  });

  test("Clear all restores the full collection", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    await screen.findByText("BBBB");
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 3 of 3 notes · sorted by # ascending"),
    ).toBeInTheDocument();
  });

  test("no matches says the view is empty and offers the recovery", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "no-such-note");

    expect(
      await screen.findByText("No notes match the active filters."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No notes in this collection yet."),
    ).not.toBeInTheDocument();

    const emptyCell = screen
      .getByText("No notes match the active filters.")
      .closest(".table-empty-cell");
    // The message lives in the frame that pins to the visible scrollport, not
    // directly in the cell that spans the table's off-screen width.
    expect(
      emptyCell.querySelector(":scope > .table-empty-frame"),
    ).not.toBeNull();
    await user.click(
      within(emptyCell).getByRole("button", { name: "Clear filters" }),
    );
    expect(await screen.findByText("AAAA")).toBeInTheDocument();
  });

  test("an empty collection still says the collection is empty", async () => {
    getNotes.mockResolvedValue({ notes: [] });
    renderTable();

    const emptyCell = (
      await screen.findByText("No notes in this collection yet.")
    ).closest(".table-empty-cell");
    expect(
      screen.queryByText("No notes match the active filters."),
    ).not.toBeInTheDocument();
    // Both ways a note can arrive are next to the sentence that says there are
    // none: adding one here, or bringing a list in through Import / Export.
    expect(
      within(emptyCell).getByRole("button", { name: "Add the first note" }),
    ).toBeInTheDocument();
    expect(
      within(emptyCell).getByRole("link", { name: "Import / Export" }),
    ).toHaveAttribute("href", "/catalog/import-export");
  });

  test("switching collections clears the chips and a reload does not restore them", async () => {
    const user = userEvent.setup();
    getNotes.mockImplementation((collectionId) =>
      Promise.resolve({
        notes:
          collectionId === 1
            ? collectionOneNotes
            : [note(4, { denomination: "DDDD" })],
      }),
    );

    const { rerender, unmount } = render(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <HashProbe />
        <NotesTable {...tableProps()} />
      </MemoryRouter>,
    );

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    // Chips are view state only: filtering writes no saved table state.
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();

    rerender(
      <MemoryRouter initialEntries={["/catalog/collections/2/view"]}>
        <HashProbe />
        <NotesTable
          {...tableProps({
            collection: { id: 2, is_default: 0, name: "Second" },
            collectionId: 2,
          })}
        />
      </MemoryRouter>,
    );

    await screen.findByText("DDDD");
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(filterFieldButton()).toHaveTextContent("Catalog");
    expect(
      screen.getByText("Showing 1 of 1 note · sorted by # ascending"),
    ).toBeInTheDocument();

    unmount();

    renderTable();
    await screen.findByText("AAAA");
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("opening a note from a filtered view snapshots the chips and keeps next/previous in the matches", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    await searchAllFields(user, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(screen.getByText("AAAA").closest("tr"));

    await waitFor(async () => {
      expect(await currentHash()).toContain("slideshow/1");
    });
    expect(await currentHash()).toContain("fc=all%3A2300");

    // BBBB (id 2) is filtered out, so Next lands on the next match.
    await user.click(screen.getByRole("button", { name: /^Next note/ }));

    await waitFor(async () => {
      const hash = await currentHash();
      expect(hash).toContain("slideshow/3");
      expect(hash).toContain("fc=all%3A2300");
    });

    await user.click(screen.getByRole("button", { name: /^Previous note/ }));

    await waitFor(async () => {
      const hash = await currentHash();
      expect(hash).toContain("slideshow/1");
      expect(hash).toContain("fc=all%3A2300");
    });

    await user.click(screen.getByRole("button", { name: "Close slideshow" }));

    await waitFor(async () => {
      expect(await currentHash()).toBe("");
    });
    expect(
      await screen.findByRole("button", { name: "Edit All fields filter 2300" }),
    ).toBeInTheDocument();
  });
});
