import { MemoryRouter, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The catalog checklist tests drive the real shell (sidebar + routes) with the
// web API mocked. The other screens are stubbed so the assertions land on the
// showcase canvas, the ownership menu, the finder, and Slideshow.
vi.mock("./lib/api.js", () => ({
  createCatalogEntry: vi.fn(),
  createCategory: vi.fn(),
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  createShowcaseNode: vi.fn(),
  deleteCategory: vi.fn(),
  deleteCollection: vi.fn(),
  deleteNode: vi.fn(),
  deleteShowcase: vi.fn(),
  getCategories: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getAllNotes: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
  updateNote: vi.fn(),
  reorderNodes: vi.fn(),
  replaceCatalogEntryWithNote: vi.fn(),
}));

vi.mock("./components/NotesTable.jsx", () => ({
  NotesTable: () => <div>Banknotes screen</div>,
}));

vi.mock("./components/CollectionScreen.jsx", () => ({
  CollectionScreen: () => <div>Collection screen</div>,
}));

vi.mock("./components/ImportScreen.jsx", () => ({
  ImportScreen: () => <div>Import and export screen</div>,
}));

vi.mock("./components/NoteEditForm.jsx", () => ({
  NoteEditForm: ({ noteId, selectedCollectionId, showCounter }) => (
    <div
      data-collection-id={selectedCollectionId}
      data-note-id={noteId}
      data-show-counter={showCounter}
    >
      Note editor screen
    </div>
  ),
}));

import { ShellContent } from "./App.jsx";
import {
  createCatalogEntry,
  deleteNode,
  getAllNotes,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  replaceCatalogEntryWithNote,
  updateCatalogEntry,
  updateNode,
  updateNote,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

const FRONT = (id) => ({
  type: "front",
  variant: "thumbnail",
  localPath: `/api/images/notes/${id}/front.jpg`,
});

const BACK = (id) => ({
  type: "back",
  variant: "thumbnail",
  localPath: `/api/images/notes/${id}/back.jpg`,
});

function note(id, { owned = true, denomination, catalog_number, issue_date, images }) {
  return {
    collection_id: 1,
    id,
    catalog_number,
    denomination,
    issue_date,
    images: images ?? [FRONT(id)],
    owned,
    tags: [],
    updated_at: `rev-${id}`,
  };
}

const OWNED_NOTE = note(101, {
  catalog_number: "22a",
  denomination: "1 leu",
  issue_date: "1917",
});
const SECOND_OWNED_ENTRY_NOTE = note(105, {
  catalog_number: "23b",
  denomination: "2 lei",
  issue_date: "1919",
});
const REFERENCE_NOTE = note(102, {
  catalog_number: "22a",
  denomination: "1 leu reference",
  issue_date: "1917",
  owned: false,
});
const SEEN_NOTE = note(103, {
  catalog_number: "24c",
  denomination: "5 lei",
  issue_date: "1920",
  owned: false,
});
const PICKER_NOTE = note(201, {
  catalog_number: "25d",
  denomination: "10 lei",
  issue_date: "1921",
});

function noteNode(id, theNote, position = 1) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: 10,
    note_id: theNote.id,
    cover_note_id: null,
    position,
    note: theNote,
    cover_note: null,
    children: [],
  };
}

function entryNode(
  id,
  { catalog_number, denomination = "1 leu", issue_date = "1917" } = {},
  position = 1,
) {
  return {
    id,
    node_type: "catalog_entry",
    name: null,
    category_id: null,
    parent_node_id: 10,
    note_id: null,
    cover_note_id: null,
    position,
    note: null,
    cover_note: null,
    children: [],
    entry: {
      catalog_number,
      denomination,
      issue_date,
      source: "",
    },
  };
}

function categoryNode(children = []) {
  return {
    id: 10,
    node_type: "category",
    name: "Summer",
    category_id: 1,
    parent_node_id: null,
    note_id: null,
    cover_note_id: null,
    position: 1,
    note: null,
    cover_note: null,
    children,
  };
}

function catalogTree() {
  return [
    categoryNode([
      // Two owned note leaves, one seen reference, and one planned shell: the
      // three card states the checklist paints.
      noteNode(30, OWNED_NOTE, 1),
      noteNode(31, SECOND_OWNED_ENTRY_NOTE, 2),
      noteNode(32, SEEN_NOTE, 3),
      entryNode(
        22,
        { catalog_number: "25d", denomination: "10 lei", issue_date: "1921" },
        4,
      ),
    ]),
  ];
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="hash">{location.hash}</span>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CollectionsProvider>
        <ShowcasesProvider>
          <LocationProbe />
          <ShellContent />
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

async function openShowcase(tree = catalogTree(), hash = "") {
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: tree });
  const result = renderAt(`${SHOWCASE_ROUTES.showcase(1)}${hash}`);
  await screen.findByRole("heading", { name: "Summer" });
  return result;
}

function expectNoteEditorOpen(noteId, collectionId) {
  const editor = screen.getByText("Note editor screen");
  expect(editor).toHaveAttribute("data-note-id", String(noteId));
  expect(editor).toHaveAttribute("data-collection-id", String(collectionId));
  expect(editor).toHaveAttribute("data-show-counter", "false");
}

function summary(container) {
  return container.querySelector(".showcase-filter-progress");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Default" }],
  });
  getShowcases.mockResolvedValue({
    showcases: [
      {
        id: 1,
        name: "My showcase",
        catalog_entry_count: 4,
        entry_count: 4,
        note_count: 0,
        owned_count: 3,
      },
    ],
  });
  getCategories.mockResolvedValue({ categories: [] });
  getAllNotes.mockResolvedValue({ notes: [PICKER_NOTE] });
  updateNote.mockImplementation(async (id, payload) => ({
    note: { ...OWNED_NOTE, ...payload, id },
  }));
});

describe("a presentation-only showcase", () => {
  function presentationOnlyTree() {
    return [
      categoryNode([
        noteNode(400, OWNED_NOTE, 1),
        noteNode(401, SEEN_NOTE, 2),
      ]),
    ];
  }

  function noteCard(name) {
    return screen.getByRole("button", { name });
  }

  test("keeps the full view toolbar without placeholders", async () => {
    const { container } = await openShowcase(presentationOnlyTree());

    expect(container.querySelector(".showcase-filter-bar")).not.toBeNull();
    expect(
      container.querySelector(
        ".showcase-filter-bar .showcase-photo-size-control",
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("group", { name: "Card filters" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Owned (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Seen (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unseen (0)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Owned cards" }),
    ).toHaveAttribute("aria-valuemax", "2");
    expect(
      screen.getByRole("group", { name: "Card layout" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Slideshow" }),
    ).toBeEnabled();
    expect(
      noteCard("Pick 22a · 1917 · 1 leu"),
    ).toBeInTheDocument();
    // A note leaf reads as a catalog card even without a placeholder in the
    // tree: same compact code line and the same ownership footer.
    expect(
      container.querySelector(".showcase-card--catalog.showcase-card--labels"),
    ).not.toBeNull();
    expect(
      noteCard("Pick 22a · 1917 · 1 leu is owned. Mark as not owned"),
    ).toBeInTheDocument();
  });

  test("filters note cards by ownership", async () => {
    const user = userEvent.setup();
    await openShowcase(presentationOnlyTree());

    await user.click(screen.getByRole("button", { name: "Owned (1)" }));

    expect(noteCard("Pick 22a · 1917 · 1 leu")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pick 24c · 1920 · 5 lei" }),
    ).not.toBeInTheDocument();
  });

  test("switches the note cards between the two layouts", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase(presentationOnlyTree());

    expect(
      container.querySelector(".showcase-card--catalog.showcase-card--labels"),
    ).not.toBeNull();

    await user.click(
      within(screen.getByRole("group", { name: "Card layout" })).getByRole(
        "radio",
        { name: "Auction rail" },
      ),
    );

    expect(
      screen.getAllByTestId("showcase-grid")[0],
    ).toHaveAttribute("data-catalog-layout", "rail");
    expect(
      container.querySelector(".showcase-card--catalog.showcase-card--rail"),
    ).not.toBeNull();
    expect(noteCard("Pick 22a · 1917 · 1 leu")).toBeInTheDocument();
  });

  test("a presentation note's footer toggles ownership", async () => {
    const user = userEvent.setup();
    await openShowcase(presentationOnlyTree());

    await user.click(
      noteCard("Pick 24c · 1920 · 5 lei is seen. Mark as owned"),
    );

    expect(updateNote).toHaveBeenCalledWith(
      103,
      expect.objectContaining({ owned: true }),
      1,
    );
  });

  test("a complete presentation showcase wears the Complete chip", async () => {
    const { container } = await openShowcase([
      categoryNode([noteNode(400, OWNED_NOTE, 1)]),
    ]);

    expect(summary(container)).toHaveTextContent("Complete");
  });

  test("reads the note text on the card, with no info tooltip", async () => {
    const detailed = {
      ...OWNED_NOTE,
      notes: "A printer's mark in the margin.",
      tags: ["margin"],
    };
    const { container } = await openShowcase([
      categoryNode([noteNode(400, detailed, 1)]),
    ]);

    expect(
      container.querySelector(".showcase-card-notes-text"),
    ).toHaveTextContent("A printer's mark in the margin.");
    // The card is the catalog card: no info icon and no `i` tooltip.
    expect(container.querySelector(".showcase-card-info")).toBeNull();
    fireEvent.keyDown(noteCard("Pick 22a · 1917 · 1 leu"), { key: "i" });
    expect(container.querySelector(".showcase-card-tooltip")).toBeNull();
  });

  test("a note with no catalog metadata still renders", async () => {
    const bare = { id: 150, collection_id: 1, images: [], tags: [] };
    await openShowcase([categoryNode([noteNode(402, bare, 1)])]);

    expect(noteCard("Untitled note")).toBeInTheDocument();
  });

  test("uses the neutral empty copy without owned cards", async () => {
    const user = userEvent.setup();
    await openShowcase([categoryNode([noteNode(401, SEEN_NOTE, 1)])]);

    await user.click(screen.getByRole("button", { name: "Owned (0)" }));

    expect(
      screen.getByText("Mark a seen card owned to see it here."),
    ).toBeInTheDocument();
  });

  test("presents only the owned notes, like a checklist", async () => {
    const user = userEvent.setup();
    await openShowcase(presentationOnlyTree());

    await user.click(screen.getByRole("button", { name: "Slideshow" }));

    const slideshow = await screen.findByRole("dialog", { name: "1 leu" });
    expect(within(slideshow).getByText(/1 of 1/)).toBeInTheDocument();
    expect(
      within(slideshow).queryByRole("button", {
        name: "Next note: 5 lei 1920",
      }),
    ).not.toBeInTheDocument();
  });

  test("a note card can be replaced with another library note in place", async () => {
    const user = userEvent.setup();
    getAllNotes.mockResolvedValue({ notes: [OWNED_NOTE, PICKER_NOTE] });
    await openShowcase(presentationOnlyTree());

    await user.click(
      screen.getByRole("button", { name: "Actions for 1 leu Pick 22a 1917" }),
    );
    const menu = screen.getByRole("menu", {
      name: "Actions for 1 leu Pick 22a 1917",
    });
    await user.click(
      within(menu).getByRole("menuitem", { name: "Replace with a note…" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Replace “Pick 22a · 1917 · 1 leu” with a note",
      }),
    ).toBeInTheDocument();
    // The note the card already holds is not a replacement candidate.
    expect(
      screen.queryByRole("checkbox", { name: /1 leu · 1917/ }),
    ).not.toBeInTheDocument();

    updateNode.mockResolvedValue({ node: noteNode(400, PICKER_NOTE, 1) });
    await user.click(screen.getByRole("checkbox", { name: /10 lei · 1921/ }));
    await user.click(
      screen.getByRole("button", { name: "Use selected note" }),
    );

    await waitFor(() =>
      expect(updateNode).toHaveBeenCalledWith(400, {
        note_id: PICKER_NOTE.id,
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Pick 25d · 1921 · 10 lei" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Note replaced.")).toBeInTheDocument();
  });

  test("keeps the view toolbar on an empty showcase", async () => {
    getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [] });
    const { container } = renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByText("This showcase is empty.");
    expect(container.querySelector(".showcase-filter-bar")).not.toBeNull();
    expect(
      container.querySelector(
        ".showcase-filter-bar .showcase-photo-size-control",
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("group", { name: "Card layout" }),
    ).toBeInTheDocument();
    // The chips and meter keep their slots so the trailing controls never
    // slide left on an empty showcase.
    expect(
      screen.getByRole("group", { name: "Card filters" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "All (0)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 0 owned")).toBeInTheDocument();
    // A zero-range bar is decoration, not a progressbar.
    expect(
      screen.queryByRole("progressbar", { name: "Owned cards" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Slideshow" }),
    ).toBeDisabled();
  });
});

describe("the catalog card layouts", () => {
  function layoutGroup() {
    return within(screen.getByRole("group", { name: "Card layout" }));
  }

  function grid() {
    return screen.getAllByTestId("showcase-grid")[0];
  }

  test("offers Library label and Auction rail with Library label by default", async () => {
    const { container } = await openShowcase();

    const group = await screen.findByRole("group", { name: "Card layout" });
    expect(within(group).getByRole("radio", { name: "Library label" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Auction rail" })).not.toBeChecked();
    expect(grid()).toHaveAttribute("data-catalog-layout", "labels");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("200px");
    expect(
      container.querySelector(".showcase-catalog-cell .showcase-card--labels"),
    ).not.toBeNull();
    expect(
      container.querySelector(".showcase-catalog-cell .showcase-card--rail"),
    ).toBeNull();
  });

  test("switches layouts, keeps the photo size, and remembers the choice", async () => {
    const user = userEvent.setup();
    const view = await openShowcase();

    await user.click(layoutGroup().getByRole("radio", { name: "Auction rail" }));

    expect(grid()).toHaveAttribute("data-catalog-layout", "rail");
    // The rail sizes its cards by column count; the photo size still feeds
    // the labels grid and the grid's data attribute.
    expect(grid()).toHaveAttribute("data-photo-size", "small");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("200px");
    expect(
      view.container.querySelector(".showcase-catalog-cell .showcase-card--rail"),
    ).not.toBeNull();
    expect(window.localStorage.getItem("noteharbor.showcaseCatalogLayout")).toBe(
      "rail",
    );

    await user.click(screen.getByRole("radio", { name: "Medium" }));
    expect(grid()).toHaveAttribute("data-photo-size", "medium");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("320px");

    await user.click(screen.getByRole("radio", { name: "Large" }));
    expect(grid()).toHaveAttribute("data-photo-size", "large");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("480px");

    await user.click(screen.getByRole("radio", { name: "Small" }));
    expect(grid()).toHaveAttribute("data-photo-size", "small");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("200px");

    await user.click(layoutGroup().getByRole("radio", { name: "Library label" }));
    expect(grid()).toHaveAttribute("data-catalog-layout", "labels");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("200px");

    // Simulate a reload: remount against the same browser storage.
    view.unmount();
    const reloaded = renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("group", { name: "Card layout" });
    expect(layoutGroup().getByRole("radio", { name: "Library label" })).toBeChecked();
    expect(
      reloaded.container.querySelector(
        ".showcase-catalog-cell .showcase-card--labels",
      ),
    ).not.toBeNull();
  });

  test("an unknown remembered layout falls back to Library label", async () => {
    window.localStorage.setItem("noteharbor.showcaseCatalogLayout", "gallery");
    await openShowcase();

    await screen.findByRole("group", { name: "Card layout" });
    expect(layoutGroup().getByRole("radio", { name: "Library label" })).toBeChecked();
    expect(grid()).toHaveAttribute("data-catalog-layout", "labels");
  });

  test("the Auction rail gives a grouping a rail identity", async () => {
    const user = userEvent.setup();
    const group = {
      id: 50,
      node_type: "grouping",
      name: "Some",
      category_id: null,
      parent_node_id: 10,
      note_id: null,
      cover_note_id: null,
      position: 5,
      note: null,
      cover_note: null,
      children: [noteNode(400, OWNED_NOTE, 1), noteNode(401, SEEN_NOTE, 2)],
    };
    await openShowcase([
      categoryNode([
        entryNode(20, { catalog_number: "22a" }, 1),
        group,
      ]),
    ]);

    const grouping = screen.getByRole("button", { name: "Open grouping Some" });
    expect(grouping).not.toHaveClass("showcase-card--grouping-rail");

    await user.click(layoutGroup().getByRole("radio", { name: "Auction rail" }));

    expect(grouping).toHaveClass("showcase-card--grouping-rail");
    expect(
      grouping.querySelector(".showcase-grouping-rail-body"),
    ).not.toBeNull();
    expect(
      grouping.querySelector(".showcase-grouping-rail-count"),
    ).toHaveTextContent("2");
    expect(grouping.querySelector(".showcase-grouping-head")).toBeNull();
  });

  test("prints the note's grade in both layouts", async () => {
    const user = userEvent.setup();
    const graded = note(106, {
      catalog_number: "26e",
      denomination: "50 lei",
      issue_date: "1922",
    });
    graded.grade = "66";
    graded.grading_company = "PMG";

    const { container } = await openShowcase([
      categoryNode([noteNode(30, graded, 1)]),
    ]);

    expect(container.querySelector(".showcase-catalog-grade b")).toHaveTextContent(
      "66",
    );
    expect(
      container.querySelector(".showcase-catalog-grade span"),
    ).toHaveTextContent("PMG");

    await user.click(layoutGroup().getByRole("radio", { name: "Auction rail" }));
    expect(container.querySelector(".showcase-catalog-grade--rail b")).toHaveTextContent(
      "66",
    );
  });
});

describe("the keyboard path through a catalog card", () => {
  // Tab walks the card body first (the slideshow opener), then the dots, then
  // the ownership footer; arrow keys already move the card focus, so the
  // picture is never a dead end. Focus never lands on the drag grip.
  test("the card body leads, then the actions menu, then the ownership label", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase();

    const cell = container.querySelector(
      '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="30"])',
    );
    const card = within(cell).getByRole("button", { name: /^Pick 22a · 1917 · 1 leu$/ });
    const trigger = within(cell).getByRole("button", { name: /^Actions for / });
    const ownership = within(cell).getByRole("button", {
      name: /is owned\. Mark as not owned/,
    });

    card.focus();
    expect(card).toHaveFocus();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.tab();
    expect(ownership).toHaveFocus();
    await user.tab();
    const nextCard = within(
      container.querySelector(
        '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="31"])',
      ),
    ).getByRole("button", { name: /^Pick 23b · 1919 · 2 lei$/ });
    expect(nextCard).toHaveFocus();
  });

  test("the rail layout walks the same path", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase();

    await user.click(
      within(screen.getByRole("group", { name: "Card layout" })).getByRole(
        "radio",
        { name: "Auction rail" },
      ),
    );

    const cell = container.querySelector(
      '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="30"])',
    );
    const card = within(cell).getByRole("button", { name: /^Pick 22a · 1917 · 1 leu$/ });
    const trigger = within(cell).getByRole("button", { name: /^Actions for / });
    const ownership = within(cell).getByRole("button", {
      name: /is owned\. Mark as not owned/,
    });

    card.focus();
    expect(card).toHaveFocus();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.tab();
    expect(ownership).toHaveFocus();
  });

  test("an unseen shell walks its body, then its dots", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase();

    const cell = container.querySelector(
      '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="22"])',
    );
    const card = within(cell).getByRole("button", {
      name: /Pick 25d .* is unseen/,
    });
    const trigger = within(cell).getByRole("button", {
      name: "Actions for Pick 25d",
    });

    card.focus();
    expect(card).toHaveFocus();
    await user.tab();
    expect(trigger).toHaveFocus();
  });
});

describe("the catalog checklist", () => {
  test("prints the owned share beside the meter, not just a percentage", async () => {
    await openShowcase();

    // The meter never needs a hover to say what it measures.
    expect(screen.getByText("2 of 4 owned")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  test("the chips and the meter describe the level you stand in", async () => {
    const user = userEvent.setup();
    const group = {
      id: 50,
      node_type: "grouping",
      name: "Sub",
      category_id: null,
      parent_node_id: 10,
      note_id: null,
      cover_note_id: null,
      position: 5,
      note: null,
      cover_note: null,
      children: [
        noteNode(30, OWNED_NOTE, 1),
        noteNode(31, SECOND_OWNED_ENTRY_NOTE, 2),
        entryNode(32, { catalog_number: "25d" }, 3),
      ],
    };

    await openShowcase([categoryNode([noteNode(20, SEEN_NOTE, 1), group])]);

    // At the root the counts describe the whole showcase tree.
    expect(
      screen.getByRole("button", { name: "All (4)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Owned (2)" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    );

    // Drilled into Sub the same chips count the two owned cards and the one
    // unseen position under it, so the numbers agree with the grid.
    expect(
      await screen.findByRole("button", { name: "All (3)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Owned (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Seen (0)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unseen (1)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Owned cards" })).toHaveAttribute(
      "aria-valuemax",
      "3",
    );
  });

  test("an empty filter at this level offers a way back to every card", async () => {
    const user = userEvent.setup();
    const group = {
      id: 50,
      node_type: "grouping",
      name: "Sub",
      category_id: null,
      parent_node_id: 10,
      note_id: null,
      cover_note_id: null,
      position: 1,
      note: null,
      cover_note: null,
      children: [
        noteNode(30, OWNED_NOTE, 1),
      ],
    };

    await openShowcase([categoryNode([group])]);
    await user.click(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    );

    // Seen exists in the showcase but not under Sub.
    await user.click(await screen.findByRole("button", { name: "Seen (0)" }));
    expect(screen.getByText("No seen cards.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all cards" }));

    expect(
      screen.getByRole("button", { name: "All (1)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("No seen cards.")).not.toBeInTheDocument();
  });

  test("a failed load names the problem and offers Try again", async () => {
    const user = userEvent.setup();
    getShowcaseTree
      .mockRejectedValueOnce(new Error("The store is offline."))
      .mockResolvedValueOnce({ showcase_id: 1, nodes: catalogTree() });

    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(await screen.findByText("Could not load this showcase.")).toBeInTheDocument();
    expect(screen.getByText("The store is offline.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
  });

  test("paints the three card states and the header counts", async () => {
    const { container } = await openShowcase();

    expect(screen.getByRole("progressbar", { name: "Owned cards" })).toHaveAttribute(
      "aria-valuenow",
      "2",
    );
    expect(screen.getByRole("progressbar", { name: "Owned cards" })).toHaveAttribute(
      "aria-valuemax",
      "4",
    );
    // The filter chips are the one place the three counts appear; the rail
    // beside them adds only the owned share.
    expect(
      screen.getByRole("button", { name: "All (4)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Owned (2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Seen (1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unseen (1)" }),
    ).toBeInTheDocument();
    expect(summary(container)).toHaveTextContent("50%");

    // Owned: the note's photo and the OWNED state label.
    expect(
      screen.getByRole("button", { name: "Pick 22a · 1917 · 1 leu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
      }),
    ).toHaveTextContent("Owned");
    // Seen: the same photo (no dimming) and the same label treatment.
    expect(
      screen.getByRole("button", {
        name: "Pick 24c · 1920 · 5 lei is seen. Mark as owned",
      }),
    ).toHaveTextContent("Seen");
    expect(container.querySelector(".showcase-card-state--seen")).not.toBeNull();
    expect(container.querySelector(".showcase-card-image--seen")).toBeNull();
    // Both labels carry the state; the card no longer paints an action row.
    expect(container.querySelector(".showcase-catalog-foot")).toBeNull();
    expect(screen.queryByText("Mark owned")).not.toBeInTheDocument();
    expect(screen.queryByText(/Add notes/)).not.toBeInTheDocument();
    // The identity lives on the card's rail, not in the cell's old window bar:
    // the compact catalog code leads the photo and the metadata row carries
    // denomination · date. The default grid is Small, which always uses the
    // compact `P22a` catalog prefix.
    expect(
      [...container.querySelectorAll(".showcase-catalog-code")].map(
        (code) => code.textContent,
      ),
    ).toEqual(["P22a", "P23b", "P24c", "P25d"]);
    expect(
      [...container.querySelectorAll(".showcase-catalog-line")].map(
        (line) => line.textContent,
      ),
    ).toEqual([
      "1 leu · 1917",
      "2 lei · 1919",
      "5 lei · 1920",
      "10 lei · 1921",
    ]);
    expect(
      container.querySelector(".showcase-catalog-cell .showcase-card-caption"),
    ).toBeNull();
    // Unseen: the neutral well and the whole card opening the finder.
    expect(
      screen.getByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    ).toBeInTheDocument();
  });

  test("the flip chord flips without moving card focus", async () => {
    const first = note(106, {
      catalog_number: "26a",
      denomination: "2 lei",
      issue_date: "1922",
      images: [FRONT(106), BACK(106)],
    });
    const second = note(107, {
      catalog_number: "27a",
      denomination: "3 lei",
      issue_date: "1923",
      images: [FRONT(107), BACK(107)],
    });
    await openShowcase([
      categoryNode([noteNode(400, first, 1), noteNode(401, second, 2)]),
    ]);

    const card = await screen.findByRole("button", {
      name: /^Pick 26a · 1922 · 2 lei$/,
    });
    act(() => card.focus());

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /^Pick 27a · 1923 · 3 lei$/ }),
    ).not.toHaveFocus();
  });

  test("keeps the compact catalog code across photo sizes and moves the width", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase();
    const firstCode = () => container.querySelector(".showcase-catalog-code");
    const grid = () => container.querySelector("[data-testid='showcase-grid']");

    expect(firstCode()).toHaveTextContent("P22a");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("200px");

    await user.click(screen.getByRole("radio", { name: "Large" }));
    expect(firstCode()).toHaveTextContent("P22a");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("480px");

    await user.click(screen.getByRole("radio", { name: "Medium" }));
    expect(firstCode()).toHaveTextContent("P22a");
    expect(grid().style.getPropertyValue("--showcase-card-min")).toBe("320px");
  });

  test("the sidebar counts owned over total entries", async () => {
    const { container } = await openShowcase();
    const marks = [...container.querySelectorAll(".sidebar-link-mark")];

    expect(marks.map((mark) => mark.textContent)).toContain("3/4");
  });

  test("filters narrow the grid and keep an empty filter calm", async () => {
    const user = userEvent.setup();
    const tree = [
      categoryNode([
        noteNode(20, OWNED_NOTE, 1),
        entryNode(
          22,
          {
            catalog_number: "25d",
            denomination: "10 lei",
            issue_date: "1921",
          },
          2,
        ),
      ]),
    ];
    await openShowcase(tree);

    await user.click(screen.getByRole("button", { name: /^Owned/ }));
    expect(
      screen.getByRole("button", { name: "Pick 22a · 1917 · 1 leu" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Seen/ }));
    expect(screen.getByText("No seen cards.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pick 22a · 1917 · 1 leu" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(
      screen.getByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    ).toBeInTheDocument();
  });

  test("the owned label marks the displayed note not owned and Undo restores it", async () => {
    const user = userEvent.setup();
    await openShowcase();

    const label = screen.getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
    });
    expect(label).not.toHaveAttribute("aria-haspopup", "menu");

    await user.click(label);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalledWith(
      OWNED_NOTE.id,
      expect.objectContaining({ owned: false }),
      1,
    );
    // The note leaf's own flag is now seen.
    expect(
      await screen.findByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is seen. Mark as owned",
      }),
    ).toBeInTheDocument();

    const undo = await screen.findByRole("button", { name: "Undo" });
    await user.click(undo);

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    expect(updateNote).toHaveBeenLastCalledWith(
      OWNED_NOTE.id,
      expect.objectContaining({ owned: true }),
      1,
    );
  });

  test("clicking a seen card opens the note instead of marking it owned", async () => {
    const user = userEvent.setup();
    const tree = [
      categoryNode([
        entryNode(
          22,
          {
            catalog_number: "25d",
            denomination: "10 lei",
            issue_date: "1921",
          },
          1,
        ),
        noteNode(400, SEEN_NOTE, 2),
      ]),
    ];
    await openShowcase(tree);

    await user.click(
      screen.getByRole("button", { name: "Pick 24c · 1920 · 5 lei" }),
    );

    expect(updateNote).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", { name: /5 lei.*Pick 24c/ }),
    ).toBeInTheDocument();
  });

  test("an unseen shell opens the finder and a picked note replaces it", async () => {
    const user = userEvent.setup();
    replaceCatalogEntryWithNote.mockResolvedValue({
      node: noteNode(22, PICKER_NOTE, 3),
    });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Replace note" });
    expect(
      within(dialog).getByText("Replace “Pick 25d” with a note"),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("checkbox", { name: /10 lei/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Use selected note" }),
    );

    await waitFor(() =>
      expect(replaceCatalogEntryWithNote).toHaveBeenCalledWith(
        22,
        PICKER_NOTE.id,
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Pick 25d · 1921 · 10 lei" }),
    ).toBeInTheDocument();
  });

  test("a reply that leaves the shell is reported instead of toasted as replaced", async () => {
    const user = userEvent.setup();
    // A server that ignores the conversion answers 200 with the unchanged
    // shell; the canvas must not claim the shell became a note.
    replaceCatalogEntryWithNote.mockResolvedValue({
      node: entryNode(
        22,
        {
          catalog_number: "25d",
          denomination: "10 lei",
          issue_date: "1921",
        },
        3,
      ),
    });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Replace note" });
    await user.click(within(dialog).getByRole("checkbox", { name: /10 lei/ }));
    await user.click(
      within(dialog).getByRole("button", { name: "Use selected note" }),
    );

    const errors = await screen.findAllByText(
      "The placeholder was not replaced.",
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      screen.queryByText("Placeholder replaced with a note."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    ).toBeInTheDocument();
  });

  test("the item menu offers ownership alongside the item actions, all with icons", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(
      screen.getByRole("button", { name: /^Actions for .*22a/ }),
    );
    const menu = screen.getByRole("menu", { name: /^Actions for .*22a/ });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(1);
    items.forEach((item) => expect(item.querySelector("svg")).not.toBeNull());

    const ownership = within(menu).getByRole("menuitem", {
      name: "Mark this note as not owned",
    });
    await user.click(ownership);

    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith(
        OWNED_NOTE.id,
        expect.objectContaining({ owned: false }),
        1,
      ),
    );
    expect(
      await screen.findByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is seen. Mark as owned",
      }),
    ).toBeInTheDocument();
  });

  test("the item menu edits the displayed note", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(
      screen.getByRole("button", { name: /^Actions for .*22a/ }),
    );
    const menu = screen.getByRole("menu", { name: /^Actions for .*22a/ });
    await user.click(
      within(menu).getByRole("menuitem", { name: "Edit note…" }),
    );

    expect(await screen.findByText("Note editor screen")).toBeInTheDocument();
    expectNoteEditorOpen(101, 1);
    expect(screen.getByTestId("hash")).toHaveTextContent("#edit/101");
  });

  test("a reload reopens the catalog entry's note editor", async () => {
    await openShowcase(catalogTree(), "#edit/101");

    expect(await screen.findByText("Note editor screen")).toBeInTheDocument();
    expectNoteEditorOpen(101, 1);
  });

  test("Slideshow lists only owned notes", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(screen.getByRole("button", { name: "Slideshow" }));

    const slideshow = await screen.findByRole("dialog", { name: "1 leu" });
    expect(within(slideshow).getByText(/1 of 2/)).toBeInTheDocument();
    // The seen note is skipped entirely.
    expect(within(slideshow).queryByText(/5 lei/)).not.toBeInTheDocument();

    await user.click(
      within(slideshow).getByRole("button", { name: "Close slideshow" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "1 leu" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Pick 22a · 1917 · 1 leu",
        }),
      ).toHaveFocus(),
    );
  });

  test("a complete catalog wears the Complete chip", async () => {
    const tree = [categoryNode([noteNode(20, OWNED_NOTE, 1)])];
    const { container } = await openShowcase(tree);

    expect(summary(container)).toHaveTextContent("Complete");
  });

  test("a note leaf in a catalog gets the state treatment but no manager", async () => {
    const user = userEvent.setup();
    const tree = [
      categoryNode([
        entryNode(20, { catalog_number: "22a" }, 1),
        noteNode(400, SEEN_NOTE, 2),
      ]),
    ];
    await openShowcase(tree);

    const seenLeaf = screen.getByRole("button", {
      name: "Pick 24c · 1920 · 5 lei is seen. Mark as owned",
    });
    await user.click(seenLeaf);
    await waitFor(() =>
      expect(updateNote).toHaveBeenCalledWith(
        SEEN_NOTE.id,
        expect.objectContaining({ owned: true }),
        1,
      ),
    );

    await user.click(
      screen.getByRole("button", { name: /Actions for 5 lei/ }),
    );
    const menu = screen.getByRole("menu", { name: /Actions for 5 lei/ });
    expect(
      within(menu).queryByRole("menuitem", { name: /Notes on this entry/ }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: /Mark this note as not owned/ }),
    ).toBeInTheDocument();
  });
});

describe("placeholders in the one view", () => {
  test("the merged Add dialog creates placeholders with metadata and no notes", async () => {
    const user = userEvent.setup();
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [categoryNode()],
    });
    createCatalogEntry.mockResolvedValueOnce({
      node: entryNode(501, { catalog_number: "22a", denomination: "20 lei" }),
    }).mockResolvedValueOnce({
      node: entryNode(502, { catalog_number: "22b", denomination: "20 lei" }),
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Add a note or placeholder" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add to “Summer”",
    });
    await user.click(within(dialog).getByRole("tab", { name: "Placeholder" }));
    await user.type(
      within(dialog).getByLabelText("Catalog numbers"),
      "22a, 22b",
    );
    await user.type(within(dialog).getByLabelText("Denomination"), "20 lei");
    await user.click(
      within(dialog).getByRole("button", { name: "Add 2 placeholders" }),
    );

    await waitFor(() => expect(createCatalogEntry).toHaveBeenCalledTimes(2));
    expect(createCatalogEntry).toHaveBeenNthCalledWith(1, 1, {
      parentId: 10,
      entry: {
        catalog_number: "22a",
        denomination: "20 lei",
        issue_date: "",
        source: "",
      },
    });
    expect(createCatalogEntry).toHaveBeenNthCalledWith(2, 1, {
      parentId: 10,
      entry: {
        catalog_number: "22b",
        denomination: "20 lei",
        issue_date: "",
        source: "",
      },
    });
    expect(
      await screen.findByRole("button", { name: /Pick 22a · 1917 · 20 lei is unseen/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Pick 22b · 1917 · 20 lei is unseen/ }),
    ).toBeInTheDocument();
  });

  test("a shell shows no specimen manager or notes-on-entry affordance", async () => {
    await openShowcase([
      categoryNode([
        entryNode(
          22,
          {
            catalog_number: "25d",
            denomination: "10 lei",
            issue_date: "1921",
          },
          1,
        ),
      ]),
    ]);

    expect(screen.queryByRole("button", { name: /notes on this entry/i }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose the primary/i }))
      .not.toBeInTheDocument();
  });

  test("editing shell details writes immediately from its menu", async () => {
    const user = userEvent.setup();
    const { container } = await openShowcase([
      categoryNode([
        entryNode(
          22,
          {
            catalog_number: "25d",
            denomination: "10 lei",
            issue_date: "1921",
          },
          1,
        ),
      ]),
    ]);
    updateCatalogEntry.mockResolvedValue({
      node: entryNode(22, {
        catalog_number: "25d",
        denomination: "100 lei",
        issue_date: "1921",
        source: "Pick catalog",
      }),
    });

    await user.click(
      screen.getByRole("button", { name: "Actions for Pick 25d" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit details…" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit placeholder",
    });
    await user.clear(within(dialog).getByLabelText("Denomination"));
    await user.type(within(dialog).getByLabelText("Denomination"), "100 lei");
    await user.type(within(dialog).getByLabelText("Source"), "Pick catalog");
    await user.click(
      within(dialog).getByRole("button", { name: "Save details" }),
    );

    await waitFor(() =>
      expect(updateCatalogEntry).toHaveBeenCalledWith(22, {
        catalog_number: "25d",
        denomination: "100 lei",
        issue_date: "1921",
        source: "Pick catalog",
      }),
    );
    await waitFor(() =>
      expect(container.querySelector(".showcase-catalog-line")).toHaveTextContent(
        "100 lei · 1921",
      ),
    );
  });

  test("removing a shell confirms and deletes immediately", async () => {
    const user = userEvent.setup();
    await openShowcase([
      categoryNode([
        entryNode(
          22,
          {
            catalog_number: "25d",
            denomination: "10 lei",
            issue_date: "1921",
          },
          1,
        ),
      ]),
    ]);
    deleteNode.mockResolvedValue({ success: true });

    await user.click(
      screen.getByRole("button", { name: "Actions for Pick 25d" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from showcase…" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(22));
    expect(
      screen.queryByRole("button", { name: /25d is unseen/ }),
    ).not.toBeInTheDocument();
  });
});
