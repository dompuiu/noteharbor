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

async function searchBox() {
  return screen.findByRole("searchbox", { name: "Search notes" });
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
  test("2300 finds the same rows as Fr. 2300", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");

    await user.type(input, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Fr. 2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("1000 finds a stored denomination of $1,000", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "$1,000", catalog_number: "Fr. 1" }),
        note(2, { denomination: "$5", catalog_number: "Fr. 2" }),
      ],
    });
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("$1,000");

    await user.type(input, "1000");

    await waitFor(() => {
      expect(screen.queryByText("$5")).not.toBeInTheDocument();
    });
    expect(screen.getByText("$1,000")).toBeInTheDocument();
  });

  test("the / key focuses the search field and the dialog says so", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    const row = within(dialog)
      .getByText("Focus the search field")
      .closest("li");
    expect(Array.from(row.querySelectorAll("kbd"), (key) => key.textContent)).toEqual([
      "/",
    ]);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument();
    });

    await user.keyboard("/");

    expect(input).toHaveFocus();
  });

  test("Escape inside the search field blurs it without clearing the query", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");
    await user.type(input, "2300");
    expect(input).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(input).not.toHaveFocus();
    expect(input).toHaveValue("2300");
  });

  test("the count sentence follows the query", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("3 notes in the current view.");

    await user.type(input, "2300");

    expect(
      await screen.findByText("2 notes in the current view."),
    ).toBeInTheDocument();
  });

  test("search ANDs with a column filter", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await user.click(
      await screen.findByRole("button", { name: "Filters" }),
    );
    const denominationFilter = await screen.findByLabelText(
      "Filter Denomination",
    );
    await screen.findByText("AAAA");

    await user.type(denominationFilter, "AAAA");
    await user.type(input, "2300");

    await waitFor(() => {
      expect(screen.queryByText("CCCC")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
  });

  test("Clear search restores the full collection", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");
    await user.type(input, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    await screen.findByText("BBBB");
    expect(input).toHaveValue("");
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
    expect(screen.getByText("3 notes in the current view.")).toBeInTheDocument();
  });

  test("no matches says the view is empty, not the collection", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");

    await user.type(input, "no-such-note");

    expect(
      await screen.findByText("No notes match the current view."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No notes are stored yet in this collection."),
    ).not.toBeInTheDocument();
  });

  test("an empty collection still says the collection is empty", async () => {
    getNotes.mockResolvedValue({ notes: [] });
    renderTable();

    await searchBox();

    expect(
      await screen.findByText("No notes are stored yet in this collection."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No notes match the current view."),
    ).not.toBeInTheDocument();
  });

  test("switching collections clears the query and a reload does not restore it", async () => {
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

    const input = await searchBox();
    await screen.findByText("AAAA");
    await user.type(input, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    // The query is view state only: it must never reach saved table state.
    expect(window.localStorage.getItem("noteharbor.notesTableState")).not.toContain(
      "2300",
    );

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
    expect(await searchBox()).toHaveValue("");
    expect(screen.getByText("1 notes in the current view.")).toBeInTheDocument();

    unmount();

    renderTable();
    await screen.findByText("AAAA");
    expect(await searchBox()).toHaveValue("");
    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("opening a note from a searched view snapshots q and keeps next/previous in the matches", async () => {
    const user = userEvent.setup();
    renderTable();

    const input = await searchBox();
    await screen.findByText("AAAA");
    await user.type(input, "2300");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(screen.getByText("AAAA").closest("tr"));

    await waitFor(async () => {
      expect(await currentHash()).toContain("slideshow/1");
    });
    expect(await currentHash()).toContain("q=2300");

    // BBBB (id 2) is filtered out, so Next lands on the next match.
    await user.click(screen.getByRole("button", { name: "Next note" }));

    await waitFor(async () => {
      const hash = await currentHash();
      expect(hash).toContain("slideshow/3");
      expect(hash).toContain("q=2300");
    });

    await user.click(screen.getByRole("button", { name: "Previous note" }));

    await waitFor(async () => {
      const hash = await currentHash();
      expect(hash).toContain("slideshow/1");
      expect(hash).toContain("q=2300");
    });

    await user.click(screen.getByRole("button", { name: "Close slideshow" }));

    await waitFor(async () => {
      expect(await currentHash()).toBe("");
    });
    expect(await searchBox()).toHaveValue("2300");
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
    expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
  });
});
