import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseFilterField, filterFieldButton } from "../test/filterBar.js";

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
    grading_company: "PMG",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "BBBB",
    catalog_number: "Fr. 500",
    grading_company: "PCGS",
    serial: "SER-2",
  }),
  note(3, {
    denomination: "CCCC",
    catalog_number: "Fr. 2300",
    grading_company: "PMG",
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

async function chooseField(user, label) {
  await chooseFilterField(user, label);
}

function filterInput(label) {
  return screen.getByLabelText(`Filter ${label}`);
}

function helpTrigger() {
  return screen.getByRole("button", { name: "How filters combine" });
}

// Choose the field, type the value and commit it with Enter.
async function commitChip(user, label, value) {
  await chooseField(user, label);
  await user.type(filterInput(label), `${value}{Enter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: String(text).length * 8 }),
  });
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

describe("NotesTable filter chips", () => {
  test("the table opens with one filter field and no chips", async () => {
    renderTable();

    await screen.findByText("AAAA");

    expect(filterFieldButton()).toHaveTextContent("Catalog");
    expect(
      screen.getByRole("searchbox", { name: "Filter Catalog" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    // No chips, and no reserved line for them: the hint moved into the ? note.
    expect(document.querySelector(".table-filter-chips")).toBeNull();
    expect(screen.queryByText(/^No filters yet/)).toBeNull();
  });

  test("the field menu marks the current field and focuses the input after a pick", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterFieldButton());

    const menu = screen.getByRole("menu", { name: "Filter field" });
    expect(
      within(menu).getByRole("menuitemradio", { name: "Catalog" }),
    ).toHaveAttribute("aria-checked", "true");

    await user.click(
      within(menu).getByRole("menuitemradio", { name: "Serial" }),
    );

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(filterFieldButton()).toHaveTextContent("Serial");
    expect(
      screen.getByRole("searchbox", { name: "Filter Serial" }),
    ).toHaveFocus();
  });

  test("Enter commits a chip and filters the rows", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Company PMG" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^No filters yet/)).toBeNull();
    expect(filterInput("Company")).toHaveValue("");
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("typing alone does not filter until Enter", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Company");
    await user.type(filterInput("Company"), "PCGS");

    // No chip, no rows hidden: the draft is not a filter yet.
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit Company/ })).toBeNull();

    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", { name: "Edit Company filter PCGS" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("two chips on one field are ORed", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Company", "PCGS");

    expect(screen.getByText("or")).toBeInTheDocument();
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("BBBB")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("chips on different fields are ANDed", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Serial", "SER-3");

    expect(screen.getByText("and")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("the Tags field opens its list only on typing or Down", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, {
          denomination: "AAAA",
          tags: [{ name: "2 digits" }, { name: "BNR: 298b" }],
        }),
        note(2, { denomination: "BBBB" }),
        note(3, { denomination: "CCCC" }),
      ],
    });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    expect(
      screen.queryByRole("listbox", { name: "Tag suggestions" }),
    ).toBeNull();

    await chooseField(user, "Tags");

    // Picking the field only lands the caret in it: the list waits for an
    // explicit open (typing or Down) rather than popping over the table.
    expect(filterInput("Tags")).toHaveFocus();
    expect(
      screen.queryByRole("listbox", { name: "Tag suggestions" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show tag suggestions" }),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowDown}");

    const list = await screen.findByRole("listbox", {
      name: "Tag suggestions",
    });
    expect(
      within(list).getByRole("option", { name: "2 digits" }),
    ).toBeInTheDocument();
    expect(filterInput("Tags")).toHaveFocus();

    await user.type(filterInput("Tags"), "2");

    expect(
      within(list).getByRole("option", { name: "2 digits" }),
    ).toBeInTheDocument();
    expect(
      within(list).getByRole("option", { name: "BNR: 298b" }),
    ).toBeInTheDocument();
    // Creating a tag belongs to the note editor, not the table filter.
    expect(
      within(list).queryByRole("option", { name: /Create/ }),
    ).toBeNull();
  });

  test("picking a tag suggestion commits its chip", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, {
          denomination: "AAAA",
          tags: [{ name: "2 digits" }],
        }),
        note(2, { denomination: "BBBB" }),
        note(3, { denomination: "CCCC" }),
      ],
    });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Tags");

    await user.keyboard("{ArrowDown}");
    const list = await screen.findByRole("listbox", {
      name: "Tag suggestions",
    });
    await user.click(within(list).getByRole("option", { name: "2 digits" }));

    expect(
      await screen.findByRole("button", {
        name: "Edit Tags filter 2 digits",
      }),
    ).toBeInTheDocument();
    expect(filterInput("Tags")).toHaveValue("");
    expect(
      screen.queryByRole("listbox", { name: "Tag suggestions" }),
    ).toBeNull();
  });

  test("an unknown tag has no create row but still commits on Enter", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, {
          denomination: "AAAA",
          tags: [{ name: "2 digits" }],
        }),
        note(2, { denomination: "BBBB" }),
        note(3, { denomination: "CCCC" }),
      ],
    });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Tags");
    await user.type(filterInput("Tags"), "never seen");

    expect(
      screen.getByRole("listbox", { name: "Tag suggestions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No matching tags."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Create/ })).toBeNull();

    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", {
        name: "Edit Tags filter never seen",
      }),
    ).toBeInTheDocument();
  });

  test("commas split one input into ORed chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG,PCGS");

    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Company filter PCGS" }),
    ).toBeInTheDocument();
  });

  test("a leading ! negates a chip", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "!PCGS");

    expect(
      screen.getByRole("button", { name: "Edit Company filter PCGS" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    expect(screen.getByText("CCCC")).toBeInTheDocument();

    // Editing keeps the negation tint, so the chip still reads as "not" while
    // its value is being changed.
    await user.click(
      screen.getByRole("button", { name: "Edit Company filter PCGS" }),
    );
    expect(
      screen.getByLabelText("Edit Company filter").closest(".table-filter-chip"),
    ).toHaveClass("table-filter-chip--negated");
  });

  test("a duplicate value is not added twice", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Company", "PMG");

    expect(
      screen.getAllByRole("button", { name: "Edit Company filter PMG" }),
    ).toHaveLength(1);
  });

  test("removing a chip restores the rows", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Remove Company PMG" }),
    );

    expect(await screen.findByText("BBBB")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Company PMG" }),
    ).toBeNull();
  });

  test("Clear all removes every chip", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Serial", "SER-3");

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    expect(await screen.findByText("BBBB")).toBeInTheDocument();
  });

  test("a chip value can be edited in place", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    await user.click(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    );

    const editor = screen.getByLabelText("Edit Company filter");
    expect(editor).toHaveFocus();
    expect(editor.selectionStart).toBe(0);
    expect(editor.selectionEnd).toBe("PMG".length);
    // The editor stays inside a chip, so the field keeps its frame while the
    // value is being changed instead of collapsing to a bare input.
    expect(editor.closest(".table-filter-chip")).not.toBeNull();
    await user.clear(editor);
    await user.type(editor, "PCGS{Enter}");

    expect(
      await screen.findByRole("button", { name: "Edit Company filter PCGS" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("editing a chip to empty removes it", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    await user.click(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    );
    const editor = screen.getByLabelText("Edit Company filter");
    await user.clear(editor);
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^Edit Company/ })).toBeNull();
    });
    expect(await screen.findByText("BBBB")).toBeInTheDocument();
  });

  test("an uncommitted draft survives a chip removal", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await chooseField(user, "Serial");
    await user.type(filterInput("Serial"), "SER");

    await user.click(
      screen.getByRole("button", { name: "Remove Company PMG" }),
    );

    expect(filterInput("Serial")).toHaveValue("SER");
  });

  test("Enter on an empty field adds nothing", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Company");
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  test("hiding a filtered column drops its chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Company" }));

    expect(
      screen.queryByRole("button", { name: /^Edit Company/ }),
    ).toBeNull();
    expect(await screen.findByText("BBBB")).toBeInTheDocument();
  });

  test("Escape above the table clears the chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    // Clicking the page chrome above the table leaves focus on <body>.
    await user.click(screen.getByRole("heading", { name: "Test" }));
    expect(document.body).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: /^Edit Company/ })).toBeNull();
    expect(await screen.findByText("BBBB")).toBeInTheDocument();
  });

  test("Escape on a header sort control keeps the chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    const sort = screen.getByRole("button", { name: "Denomination" });
    sort.focus();
    await user.keyboard("{Escape}");

    expect(sort).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
  });

  test("Reset view clears the chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(screen.queryByRole("button", { name: /^Edit Company/ })).toBeNull();
    expect(await screen.findByText("BBBB")).toBeInTheDocument();
  });

  test("the / key focuses the filter field", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.keyboard("/");

    expect(screen.getByRole("searchbox", { name: "Filter Catalog" })).toHaveFocus();
  });

  test("filters are never written to saved table state", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    // Filtering alone is not a structural change, so nothing is saved yet.
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();

    // A structural change saves the payload, and it still carries no filters.
    await user.click(screen.getByRole("button", { name: "Denomination" }));

    await waitFor(() => {
      const savedState = JSON.parse(
        window.localStorage.getItem("noteharbor.notesTableState.1"),
      );
      expect(Object.keys(savedState).sort()).toEqual([
        "sortDirection",
        "sortKey",
        "visibleColumnKeys",
      ]);
    });
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).not.toContain("PMG");
  });

  test("a saved filter does not come back on a reload", async () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        filters: { grading_company: "PMG" },
        sortKey: "id",
        sortDirection: "asc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );

    renderTable();

    await screen.findByText("AAAA");
    expect(screen.getByText("BBBB")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Edit Company/ }),
    ).toBeNull();
  });
});

// The OR/AND rule no longer occupies a 30px row: it hides behind the rail's
// ? trigger, whose note exists in the DOM only while it is open.
describe("NotesTable filter help", () => {
  const helpText =
    "No filters yet — pick a field, type, press ⏎. Same field ORs, different fields AND.";

  test("the ? trigger opens the rule note and toggles it closed", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    // The accessible name is the whole affordance; the trigger is unlabeled
    // visually on purpose.
    expect(helpTrigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(helpText)).toBeNull();

    await user.click(helpTrigger());

    expect(helpTrigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(helpText)).toBeInTheDocument();

    await user.click(helpTrigger());

    expect(helpTrigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(helpText)).toBeNull();
  });

  test("Escape closes the note and returns focus to the trigger", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(helpTrigger());

    expect(
      screen.getByRole("dialog", { name: "How filters combine" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByText(helpText)).toBeNull();
    expect(helpTrigger()).toHaveFocus();
  });

  test("a click outside the note closes it", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(helpTrigger());
    expect(screen.getByText(helpText)).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByText(helpText)).toBeNull();
  });
});

// The filters describe only the table, so they live on the card instead of a
// toolbar band above it: inside `.table-shell` and ahead of the scrollport, so
// they never pan with the columns and never scroll away with the rows.
describe("NotesTable filter rail", () => {
  function shell() {
    return document.querySelector(".table-shell");
  }

  function rail() {
    return shell().querySelector(".table-rail");
  }

  test("the filter bar is the card's rail, above the rows", async () => {
    renderTable();

    await screen.findByText("AAAA");

    const children = Array.from(shell().children);
    const viewportIndex = children.findIndex((child) =>
      child.classList.contains("table-viewport"),
    );

    expect(children[0]).toHaveClass("table-focus-anchor");
    expect(children.indexOf(rail())).toBeGreaterThan(0);
    expect(children.indexOf(rail())).toBeLessThan(viewportIndex);
    expect(
      within(rail()).getByRole("searchbox", { name: "Filter Catalog" }),
    ).toBeInTheDocument();
    expect(
      within(rail()).getByRole("button", { name: "Columns" }),
    ).toBeInTheDocument();
    // The old band above the card is gone, not merely emptied.
    expect(document.querySelector(".toolbar-row--table-controls")).toBeNull();
  });

  test("a committed filter adds its chips to the rail", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    expect(
      within(rail()).getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
    expect(rail()).toContainElement(
      document.querySelector(".table-filter-chips"),
    );
  });
});

// The chips are the filter field's own continuation: Tab reaches them before
// it reaches the rail's view controls, and Shift+Tab walks back the same
// way. Only the DOM order decides this, so the assertions are plain tabs.
describe("NotesTable filter bar tab order", () => {
  function columnsButton() {
    return screen.getByRole("button", { name: "Columns" });
  }

  test("Tab leaves the field for the help trigger when no chip exists", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterInput("Catalog"));
    expect(filterInput("Catalog")).toHaveFocus();

    await user.tab();

    expect(helpTrigger()).toHaveFocus();

    await user.tab();

    expect(columnsButton()).toHaveFocus();
  });

  test("Tab walks the chips before the Columns and Reset view controls", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Serial", "SER-3");

    const firstValue = screen.getByRole("button", {
      name: "Edit Company filter PMG",
    });
    const firstRemove = screen.getByRole("button", {
      name: "Remove Company PMG",
    });
    const secondValue = screen.getByRole("button", {
      name: "Edit Serial filter SER-3",
    });
    const secondRemove = screen.getByRole("button", {
      name: "Remove Serial SER-3",
    });
    const clearAll = screen.getByRole("button", { name: "Clear all" });
    const resetView = screen.getByRole("button", { name: "Reset view" });

    await user.click(filterInput("Serial"));
    await user.tab();
    expect(firstValue).toHaveFocus();

    await user.tab();
    expect(firstRemove).toHaveFocus();

    await user.tab();
    expect(secondValue).toHaveFocus();

    await user.tab();
    expect(secondRemove).toHaveFocus();

    await user.tab();
    expect(clearAll).toHaveFocus();

    await user.tab();
    expect(helpTrigger()).toHaveFocus();

    await user.tab();
    expect(columnsButton()).toHaveFocus();

    await user.tab();
    expect(resetView).toHaveFocus();
  });

  test("Shift+Tab walks the chips back to the filter field", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    const clearAll = screen.getByRole("button", { name: "Clear all" });
    const firstValue = screen.getByRole("button", {
      name: "Edit Company filter PMG",
    });
    const firstRemove = screen.getByRole("button", {
      name: "Remove Company PMG",
    });

    columnsButton().focus();
    await user.tab({ shift: true });
    expect(helpTrigger()).toHaveFocus();

    await user.tab({ shift: true });
    expect(clearAll).toHaveFocus();

    await user.tab({ shift: true });
    expect(firstRemove).toHaveFocus();

    await user.tab({ shift: true });
    expect(firstValue).toHaveFocus();

    await user.tab({ shift: true });
    expect(filterInput("Company")).toHaveFocus();
  });
});
