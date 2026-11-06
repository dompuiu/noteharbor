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

const tagNotes = [
  note(1, { denomination: "AAAA", tags: [{ name: "2 digits" }] }),
  note(2, { denomination: "BBBB", tags: [{ name: "BNR: 298b" }] }),
  note(3, { denomination: "CCCC" }),
];

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

function renderTable(hash = "") {
  return render(
    <MemoryRouter initialEntries={[`/catalog/collections/1/view${hash}`]}>
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

// Choose the field, type the value and commit it with Enter.
async function commitChip(user, label, value) {
  await chooseField(user, label);
  await user.type(filterInput(label), `${value}{Enter}`);
}

// The mode control's name gains a `Flip:` prefix while the field has a draft,
// so both states are found by the part that names the target mode.
function filterModeButton(target) {
  return screen.getByRole("button", {
    name: new RegExp(`switch commit mode to ${target} \\(currently`, "i"),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // The table reads a cold-open slideshow route from the real hash, not the
  // MemoryRouter's entry, so each test starts without one.
  window.history.replaceState(null, "", "/");
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
    // No chips, and no reserved line for them: the idle hint sits in their
    // slot, beside the field it explains.
    expect(document.querySelector(".table-filter-chips")).toBeNull();
    expect(document.querySelector(".table-filter-hint")).toHaveTextContent(
      "New values replace that field; other fields stay",
    );
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

  test("arrow keys walk the field menu and Home/End jump to the ends", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterFieldButton());

    const menu = screen.getByRole("menu", { name: "Filter field" });
    const choices = within(menu).getAllByRole("menuitemradio");
    const checked = choices.find(
      (choice) => choice.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveFocus();

    const checkedIndex = choices.indexOf(checked);
    await user.keyboard("{ArrowDown}");
    expect(choices[(checkedIndex + 1) % choices.length]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(checked).toHaveFocus();

    await user.keyboard("{End}");
    expect(choices[choices.length - 1]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(choices[0]).toHaveFocus();
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
    // The first chip replaces the idle hint.
    expect(screen.queryByText(/^Pick a field/)).toBeNull();
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

  test("Add mode keeps two chips on one field ORed", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    // Replace is the default; Shift+Enter latches Add without committing.
    await user.keyboard("{Shift>}{Enter}{/Shift}");
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

  // The chip line wraps between units, so the connector and the field label
  // have to travel with the chip they introduce: a wrapped line may begin with
  // "AND Company PM" but the previous line never ends on a bare "and". One chip
  // per unit is also what lets a long ORed run wrap between chips rather than
  // overflow past the chip block.
  test("a connector and a label are welded to their chip", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    // Two values on one field need Add: Replace would swap the first chip.
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await commitChip(user, "Company", "PCGS");
    await commitChip(user, "Serial", "SER-3");

    const chips = document.querySelector(".table-filter-chips");
    expect(chips).not.toBeNull();

    // Three chips, three wrapping units: the OR run and the ANDed field each
    // break between chips.
    const units = chips.querySelectorAll(".table-filter-unit");
    expect(units).toHaveLength(3);
    expect(chips.querySelector(":scope > .table-filter-and")).toBeNull();
    expect(chips.querySelector(":scope > .table-filter-or")).toBeNull();

    // The second value of a field leads with "or", the first with its label,
    // and the next field leads with "and" plus its label.
    const [first, second, third] = units;
    expect(first.querySelector(".table-filter-facet-label")).toHaveTextContent(
      "Company",
    );
    expect(first.querySelector(".table-filter-or")).toBeNull();
    expect(first.querySelector(".table-filter-and")).toBeNull();
    expect(second.querySelector(".table-filter-or")).not.toBeNull();
    expect(second.querySelector(".table-filter-chip-value")).toHaveTextContent(
      "PCGS",
    );
    expect(third.querySelector(".table-filter-and")).not.toBeNull();
    expect(third.querySelector(".table-filter-facet-label")).toHaveTextContent(
      "Serial",
    );
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

  test("a range commits one chip per value and filters by them", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "AAAA", catalog_number: "23" }),
        note(2, { denomination: "BBBB", catalog_number: "30" }),
        note(3, { denomination: "CCCC", catalog_number: "25a" }),
      ],
    });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22-25");

    // The rail states exactly what is filtered: one chip per value, just as
    // a comma list would have produced.
    for (const value of ["22", "23", "24", "25"]) {
      expect(
        screen.getByRole("button", { name: `Edit Catalog filter ${value}` }),
      ).toBeInTheDocument();
    }
    expect(filterInput("Catalog")).toHaveValue("");
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(screen.getByText("AAAA")).toBeInTheDocument();
    // Matching is unchanged, so the catalog prefix arm still matches 25a.
    expect(screen.getByText("CCCC")).toBeInTheDocument();
  });

  test("a prefixed range commits prefixed chips", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Grade", "M1-M3");

    for (const value of ["M1", "M2", "M3"]) {
      expect(
        screen.getByRole("button", { name: `Edit Grade filter ${value}` }),
      ).toBeInTheDocument();
    }
  });

  test("a slideshow link carrying a range opens with expanded chips", async () => {
    const hash = "#slideshow/1?f_catalog_number=M1-M8";
    window.location.hash = hash;
    // The cold-open chips come from the real hash; the live route reads the
    // router's, so the link has to seed both.
    renderTable(hash);

    // The table behind the slideshow states the same filter the link asked
    // for, one chip per value.
    expect(
      await screen.findByRole("button", { name: "Edit Catalog filter M1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter M8" }),
    ).toBeInTheDocument();
  });

  test("a range wider than 100 refuses the commit and keeps the draft", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Catalog");
    await user.type(filterInput("Catalog"), "1-500{Enter}");

    // Nothing was committed and the typed range is still there to shorten.
    expect(filterInput("Catalog")).toHaveValue("1-500");
    expect(
      screen.queryByRole("button", { name: /^Edit Catalog/ }),
    ).toBeNull();
    expect(screen.getByText("AAAA")).toBeInTheDocument();

    // The refusal takes the commit hint's slot rather than opening a line.
    expect(screen.getByRole("status")).toHaveTextContent(
      "Up to 100 values per range",
    );
    expect(document.querySelector(".table-filter-enter")).toBeNull();

    // The next keystroke clears it; the note is about that one draft.
    await user.type(filterInput("Catalog"), "0");
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("the refusal note clears on a successful commit and on reset", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Catalog");
    await user.type(filterInput("Catalog"), "1-500{Enter}");
    expect(screen.getByRole("status")).toBeInTheDocument();

    await user.clear(filterInput("Catalog"));
    await user.type(filterInput("Catalog"), "1-5{Enter}");

    expect(screen.queryByRole("status")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 5" }),
    ).toBeInTheDocument();
    expect(filterInput("Catalog")).toHaveValue("");

    // Reset view drops the draft and its note together.
    await user.type(filterInput("Catalog"), "1-500{Enter}");
    expect(screen.getByRole("status")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reset view" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(filterInput("Catalog")).toHaveValue("");
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
    // Duplicate suppression is an Add-mode concern: Replace would swap the
    // chip out and back in even if dedupe were broken.
    await user.keyboard("{Shift>}{Enter}{/Shift}");
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

  test("find recomputes when filters change and survives their clear", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.keyboard("{Control>}f{/Control}");
    const input = screen.getByRole("searchbox", {
      name: "Find notes in this view",
    });
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "SER-");

    await waitFor(() => {
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });

    await commitChip(user, "Company", "PMG");

    // The query stays put and is re-run over the narrower view; the filter
    // chips are find's input, not something find edits.
    await waitFor(() => {
      expect(screen.getByText("1 of 2")).toBeInTheDocument();
    });
    expect(input).toHaveValue("SER-");
    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => {
      expect(screen.getByText("1 of 3")).toBeInTheDocument();
    });
    expect(input).toHaveValue("SER-");
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

// Replace is the default commit mode: a value for a field swaps that field's
// chips and leaves every other field alone. Shift+Enter or a click on the
// field's mode control latches Add without committing.
describe("NotesTable filter commit mode", () => {
  const numberedNotes = [
    note(1, {
      denomination: "AAAA",
      catalog_number: "22",
      grading_company: "PMG",
    }),
    note(2, {
      denomination: "BBBB",
      catalog_number: "23",
      grading_company: "PCGS",
    }),
    note(3, {
      denomination: "CCCC",
      catalog_number: "24",
      grading_company: "PMG",
    }),
  ];

  test("Replace swaps only the committed field's chips", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22");
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeInTheDocument();

    await commitChip(user, "Catalog", "23");

    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("Replace leaves another field's chips in place", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Catalog", "22");
    await commitChip(user, "Catalog", "23");

    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
    expect(screen.getByText("and")).toBeInTheDocument();
  });

  test("one Replace commit may still carry an OR run", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22");
    await commitChip(user, "Catalog", "23,24");

    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 24" }),
    ).toBeInTheDocument();
    expect(screen.getByText("or")).toBeInTheDocument();
  });

  test("a later value replaces an expanded range", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22-24");
    await commitChip(user, "Catalog", "23");

    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 24" }),
    ).toBeNull();
  });

  test("a negated value replaces the same field's chips", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await commitChip(user, "Company", "!PCGS");

    expect(
      screen.queryByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Edit Company filter PCGS" })
        .closest(".table-filter-chip"),
    ).toHaveClass("table-filter-chip--negated");
  });

  test("Shift+Enter flips to Add, keeps the draft and does not commit", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22");
    await chooseField(user, "Catalog");
    await user.type(filterInput("Catalog"), "23");

    await user.keyboard("{Shift>}{Enter}{/Shift}");

    // Nothing committed: the draft is intact and the hint names Add now.
    expect(filterInput("Catalog")).toHaveValue("23");
    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeNull();
    expect(filterModeButton("Replace")).toBeInTheDocument();
    expect(screen.getByText("Commit mode: Add")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    // Add was latched: the first chip survives the second commit.
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
  });

  test("Shift+Enter with the tag list open flips instead of committing", async () => {
    getNotes.mockResolvedValue({ notes: tagNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Tags");
    await user.type(filterInput("Tags"), "2");
    await user.keyboard("{ArrowDown}");

    // A highlighted suggestion is waiting for a plain Enter.
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(filterInput("Tags")).toHaveValue("2");
    expect(screen.queryByRole("button", { name: /^Edit Tags/ })).toBeNull();
    expect(filterModeButton("Replace")).toBeInTheDocument();
    // The latch does not dismiss the list it sits above.
    expect(
      screen.getByRole("listbox", { name: "Tag suggestions" }),
    ).toBeInTheDocument();
    // The change is announced politely because focus stays in the input.
    expect(
      document.querySelector(".table-filter-mode-announcer"),
    ).toHaveAttribute("aria-live", "polite");
    expect(
      document.querySelector(".table-filter-mode-announcer"),
    ).toHaveTextContent("Commit mode: Add");
  });

  test("a click on the mode control keeps the tag list open", async () => {
    getNotes.mockResolvedValue({ notes: tagNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Tags");
    await user.type(filterInput("Tags"), "2");
    expect(
      screen.getByRole("listbox", { name: "Tag suggestions" }),
    ).toBeInTheDocument();

    await user.click(filterModeButton("Add"));

    expect(
      screen.getByRole("listbox", { name: "Tag suggestions" }),
    ).toBeInTheDocument();
    expect(filterInput("Tags")).toHaveValue("2");
    expect(filterInput("Tags")).toHaveFocus();
    expect(filterModeButton("Replace")).toBeInTheDocument();
  });

  test("clicking the mode control flips, keeps the draft and returns focus", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Catalog");
    await user.type(filterInput("Catalog"), "23");

    await user.click(filterModeButton("Add"));

    expect(filterInput("Catalog")).toHaveFocus();
    expect(filterInput("Catalog")).toHaveValue("23");
    expect(
      screen.queryByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeNull();
    expect(filterModeButton("Replace")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
  });

  test("a tag suggestion pick follows Replace", async () => {
    getNotes.mockResolvedValue({ notes: tagNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await chooseField(user, "Tags");
    await user.keyboard("{ArrowDown}");
    const firstList = await screen.findByRole("listbox", {
      name: "Tag suggestions",
    });
    await user.click(within(firstList).getByRole("option", { name: "2 digits" }));

    expect(
      screen.getByRole("button", { name: "Edit Tags filter 2 digits" }),
    ).toBeInTheDocument();

    await chooseField(user, "Tags");
    await user.type(filterInput("Tags"), "BNR");
    const secondList = await screen.findByRole("listbox", {
      name: "Tag suggestions",
    });
    await user.click(
      within(secondList).getByRole("option", { name: "BNR: 298b" }),
    );

    expect(
      screen.queryByRole("button", { name: "Edit Tags filter 2 digits" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Tags filter BNR: 298b" }),
    ).toBeInTheDocument();
  });

  test("a refused range keeps the draft, the chips and the latched mode", async () => {
    getNotes.mockResolvedValue({ notes: numberedNotes });
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Catalog", "22");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(filterInput("Catalog"), "1-500{Enter}");

    expect(filterInput("Catalog")).toHaveValue("1-500");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Up to 100 values per range",
    );
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeInTheDocument();

    // Add survived the refusal: the next commit keeps the first chip.
    await user.clear(filterInput("Catalog"));
    await user.type(filterInput("Catalog"), "23{Enter}");

    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 22" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit Catalog filter 23" }),
    ).toBeInTheDocument();
  });

  test("hiding a filtered column drops its chips and keeps the mode", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterInput("Catalog"));
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await commitChip(user, "Company", "PMG");

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(screen.getByRole("checkbox", { name: "Company" }));

    expect(
      screen.queryByRole("button", { name: /^Edit Company/ }),
    ).toBeNull();
    expect(filterModeButton("Replace")).toBeInTheDocument();
  });

  test("the latched mode survives a remount", async () => {
    const { unmount } = renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterModeButton("Add"));
    expect(filterModeButton("Replace")).toBeInTheDocument();
    unmount();

    renderTable();

    await screen.findByText("AAAA");
    expect(filterModeButton("Replace")).toBeInTheDocument();
  });

  test("the mode control flips from the keyboard and returns focus", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterInput("Catalog"));
    await user.tab();

    expect(filterModeButton("Add")).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(filterModeButton("Replace")).toBeInTheDocument();
    expect(filterInput("Catalog")).toHaveFocus();

    // Space latches Replace again, the same way a click would.
    await user.tab();
    expect(filterModeButton("Replace")).toHaveFocus();
    await user.keyboard(" ");

    expect(filterModeButton("Add")).toBeInTheDocument();
    expect(filterInput("Catalog")).toHaveFocus();
  });

  test("at rest the mode control leads the / keycap", async () => {
    renderTable();

    await screen.findByText("AAAA");

    const field = document.querySelector(".table-search--scoped");
    const button = filterModeButton("Add");
    const keycap = field.querySelector(".table-search-hint");

    expect(button).toHaveTextContent("replace");
    expect(button).toHaveAttribute(
      "title",
      "Click or Shift+Enter to switch to Add",
    );
    expect(keycap).toHaveTextContent("/");
    expect(Array.from(field.children).indexOf(button)).toBeLessThan(
      Array.from(field.children).indexOf(keycap),
    );
  });

  test("typing names the commit and the flip key beside it", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.type(filterInput("Catalog"), "22");

    const hint = document.querySelector(".table-filter-enter");
    const keycaps = hint.querySelectorAll("kbd");

    expect(hint).toHaveTextContent("⏎");
    expect(hint).toHaveTextContent("replace");
    expect(hint).toHaveTextContent("·");
    expect(hint).toHaveTextContent("flip");
    expect(hint).toHaveTextContent("⇧⏎");
    expect(keycaps[0]).toHaveTextContent("⏎");
    expect(keycaps[1]).toHaveTextContent("⇧⏎");
    expect(hint.querySelector("button")).toHaveTextContent("flip");
    // The visible word leads the name, so speech input can find it.
    expect(hint.querySelector("button")).toHaveAccessibleName(
      "Flip: switch commit mode to Add (currently Replace)",
    );
  });
});


describe("NotesTable filter hint", () => {
  const replaceHint = "New values replace that field; other fields stay";
  const addHint =
    "Pick a field, type, press ⏎. Same field ORs, different fields AND.";

  function filterHint() {
    return document.querySelector(".table-filter-hint");
  }

  test("the idle rail states the Replace default beside the field", async () => {
    renderTable();

    await screen.findByText("AAAA");

    const hint = filterHint();
    const rail = document.querySelector(".table-rail");

    expect(hint).toHaveTextContent(replaceHint);
    expect(rail).toContainElement(hint);
    expect(hint).toHaveClass("table-filter-hint");
    // The Replace sentence names no key: the field's own hint carries ⏎.
    expect(hint.querySelector("kbd")).toBeNull();
    // The hint replaced the ? trigger rather than joining it.
    expect(
      screen.queryByRole("button", { name: "How filters combine" }),
    ).toBeNull();
  });

  test("Add mode restores the OR/AND sentence", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterModeButton("Add"));

    expect(filterHint()).toHaveTextContent(addHint);
    expect(filterHint().querySelector("kbd")).toHaveTextContent("⏎");
  });

  test("the first chip replaces the hint", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");

    expect(filterHint()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
  });

  test("clearing every chip brings the hint back", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await commitChip(user, "Company", "PMG");
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    await waitFor(() => expect(filterHint()).toHaveTextContent(replaceHint));
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
    expect(
      within(rail()).getByRole("button", { name: "Add note" }),
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
// it reaches the rail's trailing cluster, and Shift+Tab walks back the same
// way. Only the DOM order decides this, so the assertions are plain tabs.
describe("NotesTable filter bar tab order", () => {
  function addNoteButton() {
    return screen.getByRole("button", { name: "Add note" });
  }

  function columnsButton() {
    return screen.getByRole("button", { name: "Columns" });
  }

  test("Tab leaves the field for the mode control, then Add note", async () => {
    renderTable();
    const user = userEvent.setup();

    await screen.findByText("AAAA");
    await user.click(filterInput("Catalog"));
    expect(filterInput("Catalog")).toHaveFocus();

    // The mode control is the field's own trailing hint, so it is the next
    // stop; the idle rail sentence is prose, not a stop.
    await user.tab();
    expect(filterModeButton("Add")).toHaveFocus();

    await user.tab();

    expect(addNoteButton()).toHaveFocus();
  });

  test("Tab walks the chips before Add note, Find, Reset view and Columns", async () => {
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
    expect(filterModeButton("Add")).toHaveFocus();

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
    expect(addNoteButton()).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Find in this view" }),
    ).toHaveFocus();

    await user.tab();
    expect(resetView).toHaveFocus();

    await user.tab();
    expect(columnsButton()).toHaveFocus();
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
    expect(screen.getByRole("button", { name: "Reset view" })).toHaveFocus();

    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Find in this view" }),
    ).toHaveFocus();

    await user.tab({ shift: true });
    expect(addNoteButton()).toHaveFocus();

    await user.tab({ shift: true });
    expect(clearAll).toHaveFocus();

    await user.tab({ shift: true });
    expect(firstRemove).toHaveFocus();

    await user.tab({ shift: true });
    expect(firstValue).toHaveFocus();

    await user.tab({ shift: true });
    expect(filterModeButton("Add")).toHaveFocus();

    await user.tab({ shift: true });
    expect(filterInput("Company")).toHaveFocus();
  });
});
