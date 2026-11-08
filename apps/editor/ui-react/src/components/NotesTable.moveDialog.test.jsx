import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseSelectOption } from "../test/selectField.js";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  moveNotes: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
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

import { getNotes, moveNotes } from "../lib/api.js";
import { defaultTableState } from "../lib/notesTableState.js";

const collections = [
  { id: 1, is_default: 1, name: "Test" },
  { id: 2, is_default: 0, name: "Other" },
];

let notesDb;
let targetNotes;

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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="route">
      {location.pathname}
      {location.search}
      {location.hash}
    </div>
  );
}

function renderTable({ collectionList = collections } = {}) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <LocationProbe />
      <NotesTable
        collection={collectionList[0]}
        collectionId={collectionList[0].id}
        collections={collectionList}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

function currentRoute() {
  return screen.getByTestId("route").textContent;
}

async function openRowMenu(user, denomination) {
  await screen.findByText(denomination);
  await user.click(
    screen.getByRole("button", { name: `Actions for ${denomination}` }),
  );
  return screen.findByRole("menu", { name: `Actions for ${denomination}` });
}

async function openBulkMove(user) {
  await screen.findByText("AAAA");
  await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
  await user.click(screen.getByRole("button", { name: "Move to…" }));
  return screen.findByRole("dialog", { name: "Move note" });
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

  notesDb = [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")];
  targetNotes = [note(10, "TARGET-1"), note(11, "TARGET-2")];
  getNotes.mockImplementation(async (collectionId) => ({
    notes: collectionId === 2 ? [...targetNotes] : [...notesDb],
  }));
  moveNotes.mockImplementation(async (ids) =>
    ids.map((id) => ({ ...notesDb.find((entry) => entry.id === id), collection_id: 2 })),
  );
});

describe("moving notes from the table", () => {
  test("the bulk bar puts Move to… before Delete, and hides it with one collection", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));

    const bar = screen.getByRole("region", { name: "Selection actions" });
    const labels = within(bar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(labels).toEqual([
      "Move 1 selected note up",
      "Move 1 selected note down",
      "Move to…",
      "Tags…",
      "Delete",
      "Clear selection",
    ]);

    unmount();

    renderTable({ collectionList: [collections[0]] });
    await screen.findByText("AAAA");
    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));

    const singleBar = screen.getByRole("region", { name: "Selection actions" });
    expect(
      within(singleBar).queryByRole("button", { name: "Move to…" }),
    ).not.toBeInTheDocument();
    expect(
      within(singleBar).getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  test("the row menu keeps Move to… above the rule that sets Delete apart", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTable();

    const menu = await openRowMenu(user, "AAAA");
    const menuItems = within(menu).getAllByRole("menuitem");
    const labels = menuItems.map((item) => item.textContent);

    expect(labels.slice(-4)).toEqual([
      "Move to…",
      "Move up",
      "Move down",
      "Delete",
    ]);

    const children = Array.from(menu.children);
    const separatorIndex = children.findIndex(
      (child) => child.className === "row-actions-menu-separator",
    );
    expect(separatorIndex).toBeGreaterThan(0);
    expect(children[separatorIndex - 1].textContent).toContain("Move down");
    expect(children[separatorIndex - 3].textContent).toContain("Move to…");
    expect(children[separatorIndex + 1].textContent).toContain("Delete");

    unmount();

    renderTable({ collectionList: [collections[0]] });
    const singleMenu = await openRowMenu(user, "AAAA");
    expect(
      within(singleMenu).queryByRole("menuitem", { name: "Move to…" }),
    ).not.toBeInTheDocument();
    expect(
      within(singleMenu).getByRole("menuitem", { name: "Delete" }),
    ).toBeInTheDocument();
  });

  test("a bulk move keeps the table's order and redirects by default", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("AAAA");
    // Tick the later row first: the dialog must follow the table, not the
    // order the checkboxes were clicked.
    await user.click(screen.getByRole("checkbox", { name: "Select CCCC" }));
    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("button", { name: "Move to…" }));

    const dialog = await screen.findByRole("dialog", { name: "Move 2 notes" });
    expect(
      within(dialog).getByRole("combobox", { name: "Collection" }),
    ).toHaveValue("Other");
    expect(
      within(dialog).getByRole("combobox", { name: "Position in collection" }),
    ).toHaveValue("End of collection");

    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNotes).toHaveBeenCalledWith(
        [1, 3],
        1,
        2,
        { mode: "end", referenceId: null },
      );
      expect(currentRoute()).toBe("/catalog/collections/2/view");
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved 2 notes to Other.",
    );
  });

  test("a redirect reopens the table with the default sort", async () => {
    const user = userEvent.setup();
    // This harness keeps the same NotesTable props across the redirect, so the
    // reset lands on the collection it is showing.
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "denomination",
        sortDirection: "desc",
        visibleColumnKeys: [],
      }),
    );
    renderTable();

    const dialog = await openBulkMove(user);
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(
        JSON.parse(window.localStorage.getItem("noteharbor.notesTableState.1")),
      ).toMatchObject({
        sortKey: defaultTableState().sortKey,
        sortDirection: defaultTableState().sortDirection,
      });
    });
  });

  test("a row menu move of one note sends a list of one", async () => {
    const user = userEvent.setup();
    renderTable();

    const menu = await openRowMenu(user, "BBBB");
    await user.click(within(menu).getByRole("menuitem", { name: "Move to…" }));

    const dialog = await screen.findByRole("dialog", { name: "Move note" });
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNotes).toHaveBeenCalledWith(
        [2],
        1,
        2,
        { mode: "end", referenceId: null },
      );
    });
  });

  test("before a note picks that note from the destination", async () => {
    const user = userEvent.setup();
    renderTable();

    const dialog = await openBulkMove(user);
    await chooseSelectOption(
      user,
      "Position in collection",
      "Before a note...",
    );

    const picker = await within(dialog).findByText("TARGET-1");
    await user.click(picker.closest("button"));
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNotes).toHaveBeenCalledWith(
        [1],
        1,
        2,
        { mode: "before", referenceId: 10 },
      );
    });
  });

  test("Before/After cannot be confirmed without a reference note", async () => {
    const user = userEvent.setup();
    renderTable();

    const dialog = await openBulkMove(user);
    await chooseSelectOption(
      user,
      "Position in collection",
      "Before a note...",
    );

    expect(within(dialog).getByRole("button", { name: "Move" })).toBeDisabled();
    expect(
      within(dialog).getByText("Select a reference note from the list below."),
    ).toBeInTheDocument();

    const picker = await within(dialog).findByText("TARGET-1");
    await user.click(picker.closest("button"));
    expect(within(dialog).getByRole("button", { name: "Move" })).toBeEnabled();
  });

  test("choosing the same collection does nothing and clears the selection", async () => {
    const user = userEvent.setup();
    renderTable();

    const dialog = await openBulkMove(user);
    await chooseSelectOption(user, "Collection", "Test");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(moveNotes).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(currentRoute()).toBe("/catalog/collections/1/view");
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
  });

  test("turning the redirect off stays on this table with a toast", async () => {
    const user = userEvent.setup();
    renderTable();

    const dialog = await openBulkMove(user);
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Show Other after moving",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Moved to Other.",
    );
    expect(currentRoute()).toBe("/catalog/collections/1/view");
    expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).not.toBeInTheDocument();
  });
});
