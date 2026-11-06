import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  reorderNotes: vi.fn(),
  updateNotesTags: vi.fn(),
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

import { getNotes, getTags, updateNotesTags } from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Test" },
  { id: 2, is_default: 0, name: "Other" },
];

let notesDb;

function note(id, denomination, tags = []) {
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
    tags: tags.map((name, index) => ({ id: id * 10 + index, name })),
  };
}

function tagNames(note) {
  return note.tags.map((tag) => tag.name);
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <NotesTable
        collection={collections[0]}
        collectionId={1}
        collections={collections}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

async function selectRows(user, denominations) {
  await screen.findByText(denominations[0]);

  for (const denomination of denominations) {
    await user.click(
      screen.getByRole("checkbox", { name: `Select ${denomination}` }),
    );
  }
}

async function openTagsPanel(user) {
  await user.click(screen.getByRole("button", { name: "Tags…" }));
  return screen.findByRole("dialog", { name: "Tags" });
}

function tagRow(panel, name) {
  return within(panel)
    .getByRole("button", {
      name: `Remove ${name} from the selected notes`,
    })
    .closest("li");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: text.length * 7 }),
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

  notesDb = [
    note(1, "AAAA", ["Hoard", "Silver"]),
    note(2, "BBBB", ["Hoard"]),
    note(3, "CCCC", ["For sale", "Hoard"]),
  ];

  getNotes.mockImplementation(async () => ({ notes: [...notesDb] }));
  getTags.mockResolvedValue({
    tags: [
      { id: 10, name: "Gold" },
      { id: 11, name: "Hoard" },
    ],
  });
  updateNotesTags.mockImplementation(async (collectionId, ids, add, remove) => {
    const addKeys = new Set(add.map((name) => name.toLowerCase()));
    const removeKeys = new Set(remove.map((name) => name.toLowerCase()));

    notesDb = notesDb.map((entry) => {
      if (!ids.includes(entry.id)) {
        return entry;
      }

      const kept = entry.tags.filter(
        (tag) => !removeKeys.has(tag.name.toLowerCase()),
      );
      const keptKeys = new Set(kept.map((tag) => tag.name.toLowerCase()));
      const added = add
        .filter((name) => !keptKeys.has(name.toLowerCase()))
        .map((name, index) => ({ id: entry.id * 100 + index, name }));

      return { ...entry, tags: [...kept, ...added] };
    });

    return {
      notes: ids.map((id) => notesDb.find((entry) => entry.id === id)),
    };
  });
});

describe("bulk Tag editing from the selection bar", () => {
  test("Tags… appears only with a selection, between Move to… and Delete", async () => {
    const user = userEvent.setup();
    const { unmount } = renderTable();

    await screen.findByText("AAAA");
    expect(
      screen.queryByRole("button", { name: "Tags…" }),
    ).not.toBeInTheDocument();

    await selectRows(user, ["AAAA"]);
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

    const tagsButton = within(bar).getByRole("button", { name: "Tags…" });
    expect(tagsButton).toHaveAttribute("aria-haspopup", "dialog");
    expect(tagsButton).toHaveAttribute("aria-expanded", "false");

    unmount();
  });

  test("the panel centres over the selection bar, not its Tags button", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA"]);

    const bar = screen.getByRole("region", { name: "Selection actions" });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      bottom: 540,
      height: 40,
      left: 100,
      right: 700,
      top: 500,
      width: 600,
      x: 100,
      y: 500,
      toJSON: () => ({}),
    });

    const panel = await openTagsPanel(user);

    // A 600px bar at x=100 has its centre at 400; the 440px panel starts at
    // 180. Centring on the 1000px-wide Tags button would put it at 280.
    expect(panel).toHaveStyle({ left: "180px" });
  });

  test("shows coverage counts and the all-notes pill", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA", "BBBB", "CCCC"]);

    const panel = await openTagsPanel(user);

    expect(
      within(panel).getByText(
        "3 selected notes · staged changes apply together",
      ),
    ).toBeInTheDocument();

    const hoard = tagRow(panel, "Hoard");
    expect(hoard).toHaveTextContent("Hoard");
    expect(hoard).toHaveTextContent("3/3");
    expect(within(hoard).getByText("3/3")).toHaveClass("is-all");

    expect(tagRow(panel, "Silver")).toHaveTextContent("1/3");
    expect(tagRow(panel, "For sale")).toHaveTextContent("1/3");

    // Focusing the add field no longer dumps the vocabulary open: the list
    // waits for the chevron (or typing) and then shows coverage for a Tag
    // only some selected notes carry.
    const input = within(panel).getByRole("combobox", { name: "Add a tag" });
    expect(input).toHaveFocus();
    expect(
      screen.queryByRole("listbox", { name: "Tag suggestions" }),
    ).not.toBeInTheDocument();

    await user.click(
      within(panel).getByRole("button", { name: "Show tag suggestions" }),
    );

    const silverOption = await screen.findByRole("option", { name: /Silver/ });
    expect(silverOption).toHaveTextContent("1/3");
    expect(
      await screen.findByRole("option", { name: /Gold/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Show tag suggestions" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  test("stages adds and removes, keeps them mutually exclusive, and disables Apply until one exists", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA"]);

    const panel = await openTagsPanel(user);
    const apply = within(panel).getByRole("button", {
      name: "Apply to 1 note",
    });
    expect(apply).toBeDisabled();

    const input = within(panel).getByRole("combobox", { name: "Add a tag" });
    await user.type(input, "Hoard");
    await user.keyboard("{Enter}");

    expect(
      within(panel).getByText("Hoard", { selector: ".table-filter-chip-value" }),
    ).toBeInTheDocument();
    expect(apply).toBeEnabled();

    // Staging a removal of the same Tag clears the staged addition.
    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Hoard from the selected notes",
      }),
    );
    expect(
      within(panel).getByRole("button", { name: "Undo removal of Hoard" }),
    ).toBeInTheDocument();
    expect(
      within(panel).queryByText("Hoard", { selector: ".table-filter-chip-value" }),
    ).not.toBeInTheDocument();

    // Adding it back clears the staged removal instead.
    await user.type(input, "Hoard");
    await user.keyboard("{Enter}");
    expect(
      within(panel).queryByRole("button", { name: "Undo removal of Hoard" }),
    ).not.toBeInTheDocument();

    // An unknown name offers the create arm, which stages it the same way.
    await user.type(input, "Brand New");
    await user.click(
      await screen.findByRole("option", { name: /\+ Create “Brand New”/ }),
    );
    expect(
      within(panel).getByText("Brand New", {
        selector: ".table-filter-chip-value",
      }),
    ).toBeInTheDocument();
  });

  test("Apply sends one request with the selection's ids and both lists, refetches, keeps the selection and toasts", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await selectRows(user, ["AAAA", "CCCC"]);

    const panel = await openTagsPanel(user);
    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Silver from the selected notes",
      }),
    );
    const input = within(panel).getByRole("combobox", { name: "Add a tag" });
    await user.type(input, "Gold");
    await user.keyboard("{Enter}");
    await user.click(
      within(panel).getByRole("button", { name: "Apply to 2 notes" }),
    );

    await waitFor(() => {
      expect(updateNotesTags).toHaveBeenCalledTimes(1);
    });
    expect(updateNotesTags).toHaveBeenCalledWith(1, [1, 3], ["Gold"], [
      "Silver",
    ]);

    expect(
      await screen.findByText("Tags updated on 2 notes"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select AAAA" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select CCCC" }),
    ).toBeChecked();

    const row = Array.from(
      container.querySelectorAll("tbody tr.table-row-link"),
    ).find((entry) => entry.textContent.includes("AAAA"));
    expect(row.textContent).toContain("Gold");
    expect(row.textContent).not.toContain("Silver");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tags…" })).toHaveFocus();
    });
  });

  test("a failed Apply keeps the panel and its staged lists with an inline error", async () => {
    const user = userEvent.setup();
    updateNotesTags.mockRejectedValueOnce(new Error("Tags could not be saved."));
    renderTable();
    await selectRows(user, ["AAAA"]);

    const panel = await openTagsPanel(user);
    await user.click(
      within(panel).getByRole("button", {
        name: "Remove Silver from the selected notes",
      }),
    );
    const input = within(panel).getByRole("combobox", { name: "Add a tag" });
    await user.type(input, "Gold");
    await user.keyboard("{Enter}");

    await user.click(
      within(panel).getByRole("button", { name: "Apply to 1 note" }),
    );

    expect(
      await within(panel).findByText("Tags could not be saved."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
    expect(
      within(panel).getByText("Gold", { selector: ".table-filter-chip-value" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Undo removal of Silver" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Apply to 1 note" }),
    ).toBeEnabled();
  });

  test("Clear all tags… asks first and then removes every tag on the selection", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA", "BBBB"]);

    const panel = await openTagsPanel(user);
    await user.click(within(panel).getByRole("button", { name: "Clear all tags…" }));

    const confirm = await screen.findByRole("dialog", {
      name: "Remove all tags from 2 notes?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(updateNotesTags).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Clear all tags…" }));
    await user.click(
      await screen.findByRole("button", { name: "Remove all tags" }),
    );

    await waitFor(() => {
      expect(updateNotesTags).toHaveBeenCalledTimes(1);
    });
    const [, ids, add, remove] = updateNotesTags.mock.calls[0];
    expect(ids).toEqual([1, 2]);
    expect(add).toEqual([]);
    expect(remove).toEqual(["Hoard", "Silver"]);
    expect(
      await screen.findByText("Tags updated on 2 notes"),
    ).toBeInTheDocument();
  });

  test("Escape dismisses the suggestion list before the panel", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA"]);

    const panel = await openTagsPanel(user);
    await user.click(
      within(panel).getByRole("button", { name: "Show tag suggestions" }),
    );
    expect(
      await screen.findByRole("listbox", { name: "Tag suggestions" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    // The first Escape belongs to the open list: the panel and its focus stay.
    expect(
      screen.queryByRole("listbox", { name: "Tag suggestions" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Tags" })).toBeInTheDocument();
    expect(
      within(panel).getByRole("combobox", { name: "Add a tag" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tags…" })).toHaveFocus();
    });
  });

  test("Escape closes and restores focus, Tab stays inside the panel, and the keyboard stages and un-stages", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA"]);

    const panel = await openTagsPanel(user);
    const input = within(panel).getByRole("combobox", { name: "Add a tag" });
    expect(input).toHaveFocus();

    // Type, move through the suggestions, stage with Enter, un-stage with
    // Backspace on the empty input.
    await user.type(input, "Go");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(
      within(panel).getByText("Gold", { selector: ".table-filter-chip-value" }),
    ).toBeInTheDocument();
    await user.type(input, "{Backspace}");
    expect(
      within(panel).queryByText("Gold", {
        selector: ".table-filter-chip-value",
      }),
    ).not.toBeInTheDocument();

    // Stage again so Apply is focusable, then prove focus wraps.
    await user.type(input, "Gold");
    await user.keyboard("{Enter}");
    const apply = within(panel).getByRole("button", {
      name: "Apply to 1 note",
    });
    apply.focus();
    fireEvent.keyDown(apply, { key: "Tab" });
    const close = within(panel).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(apply).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Tags…" })).toHaveFocus();
    });
  });

  test("a selection change closes the panel and discards its staged set", async () => {
    const user = userEvent.setup();
    renderTable();
    await selectRows(user, ["AAAA"]);

    let panel = await openTagsPanel(user);
    await user.type(
      within(panel).getByRole("combobox", { name: "Add a tag" }),
      "Gold",
    );
    await user.keyboard("{Enter}");
    expect(
      within(panel).getByText("Gold", { selector: ".table-filter-chip-value" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select BBBB" }));
    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument();

    panel = await openTagsPanel(user);
    expect(
      within(panel).getByRole("button", { name: "Apply to 2 notes" }),
    ).toBeDisabled();
  });

  test("a failed vocabulary load still shows the selection's own tags", async () => {
    const user = userEvent.setup();
    getTags.mockRejectedValueOnce(new Error("offline"));
    renderTable();
    await selectRows(user, ["AAAA"]);

    const panel = await openTagsPanel(user);

    expect(
      await within(panel).findByText(/Suggestions unavailable/),
    ).toBeInTheDocument();
    expect(tagRow(panel, "Hoard")).toHaveTextContent("1/1");
    expect(tagRow(panel, "Silver")).toHaveTextContent("1/1");
    expect(tagNames(notesDb[0])).toEqual(["Hoard", "Silver"]);
  });
});
