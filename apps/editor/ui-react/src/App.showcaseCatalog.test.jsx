import { MemoryRouter } from "react-router-dom";
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
  updateNodeNotes: vi.fn(),
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
  NoteEditForm: () => <div>Note editor screen</div>,
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
  updateNodeNotes,
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
  { catalog_number, specimens = [], primary = null, denomination = "1 leu", issue_date = "1917" },
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
    specimens,
    primary_note_id: primary,
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
      // Owned through an owned primary, with a seen reference beside it.
      entryNode(
        20,
        {
          catalog_number: "22a",
          specimens: [OWNED_NOTE, REFERENCE_NOTE],
          primary: OWNED_NOTE.id,
        },
        1,
      ),
      // Seen: specimens exist, none owned.
      entryNode(
        21,
        {
          catalog_number: "24c",
          denomination: "5 lei",
          issue_date: "1920",
          specimens: [SEEN_NOTE],
          primary: SEEN_NOTE.id,
        },
        2,
      ),
      // Unseen: a position with no record at all.
      entryNode(
        22,
        {
          catalog_number: "25d",
          denomination: "10 lei",
          issue_date: "1921",
        },
        3,
      ),
      // A second owned entry, for the presentation count.
      entryNode(
        23,
        {
          catalog_number: "23b",
          denomination: "2 lei",
          issue_date: "1919",
          specimens: [SECOND_OWNED_ENTRY_NOTE],
          primary: SECOND_OWNED_ENTRY_NOTE.id,
        },
        4,
      ),
    ]),
  ];
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CollectionsProvider>
        <ShowcasesProvider>
          <ShellContent />
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

async function openShowcase(tree = catalogTree()) {
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: tree });
  const result = renderAt(SHOWCASE_ROUTES.showcase(1));
  await screen.findByRole("heading", { name: "Summer" });
  return result;
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
  updateNodeNotes.mockResolvedValue({ node: null });
});

describe("a presentation-only showcase", () => {
  test("keeps its existing chrome without catalog counts or filters", async () => {
    await openShowcase([categoryNode([noteNode(400, OWNED_NOTE, 1)])]);

    expect(
      screen.queryByRole("progressbar", { name: "Owned cards" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Catalog filters" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Card layout" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Slideshow" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 notes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 leu, Pick 22a, 1917" }),
    ).toBeInTheDocument();
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

  test("prints the specimen grade in both layouts", async () => {
    const user = userEvent.setup();
    const graded = note(106, {
      catalog_number: "26e",
      denomination: "50 lei",
      issue_date: "1922",
    });
    graded.grade = "66";
    graded.grading_company = "PMG";

    const { container } = await openShowcase([
      categoryNode([
        entryNode(
          30,
          {
            catalog_number: "26e",
            denomination: "50 lei",
            issue_date: "1922",
            specimens: [graded],
            primary: graded.id,
          },
          1,
        ),
      ]),
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
      '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="20"])',
    );
    const card = within(cell).getByRole("button", {
      name: "Slideshow from Pick 22a · 1917 · 1 leu",
    });
    const trigger = within(cell).getByRole("button", {
      name: "Actions for Pick 22a",
    });
    const ownership = within(cell).getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
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
        '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="21"])',
      ),
    ).getByRole("button", { name: /^Slideshow from Pick 24c/ });
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
      '.showcase-reorder-cell:has(.showcase-catalog-cell[data-showcase-node-id="20"])',
    );
    const card = within(cell).getByRole("button", {
      name: "Slideshow from Pick 22a · 1917 · 1 leu",
    });
    const trigger = within(cell).getByRole("button", {
      name: "Actions for Pick 22a",
    });
    const ownership = within(cell).getByRole("button", {
      name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
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

    // Owned: primary photo, a Slideshow action, and the OWNED state label.
    expect(
      screen.getByRole("button", { name: "Slideshow from Pick 22a · 1917 · 1 leu" }),
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
    // date · denomination. The default grid is Small, which always uses the
    // compact `P22a` catalog prefix.
    expect(
      [...container.querySelectorAll(".showcase-catalog-code")].map(
        (code) => code.textContent,
      ),
    ).toEqual(["P22a", "P24c", "P25d", "P23b"]);
    expect(
      [...container.querySelectorAll(".showcase-catalog-line")].map(
        (line) => line.textContent,
      ),
    ).toEqual([
      "1917 · 1 leu",
      "1920 · 5 lei",
      "1921 · 10 lei",
      "1919 · 2 lei",
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

  test("a catalog entry card with a back flips in place", async () => {
    const user = userEvent.setup();
    const flippable = note(106, {
      catalog_number: "26a",
      denomination: "2 lei",
      issue_date: "1922",
      images: [FRONT(106), BACK(106)],
    });
    await openShowcase([
      categoryNode([
        entryNode(
          400,
          {
            catalog_number: "26a",
            denomination: "2 lei",
            issue_date: "1922",
            specimens: [flippable],
            primary: flippable.id,
          },
          1,
        ),
      ]),
    ]);

    const card = await screen.findByRole("button", {
      name: "Slideshow from Pick 26a · 1922 · 2 lei",
    });
    expect(card.querySelector(".showcase-card-flip")).toBeNull();

    fireEvent.mouseEnter(card.closest(".showcase-cell"));
    await user.click(card.querySelector(".showcase-card-flip"));

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/106/back.jpg?v=rev-106",
    );

    await user.unhover(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/106/front.jpg?v=rev-106",
    );
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
      categoryNode([
        entryNode(
          400,
          {
            catalog_number: "26a",
            denomination: "2 lei",
            issue_date: "1922",
            specimens: [first],
            primary: first.id,
          },
          1,
        ),
        entryNode(
          401,
          {
            catalog_number: "27a",
            denomination: "3 lei",
            issue_date: "1923",
            specimens: [second],
            primary: second.id,
          },
          2,
        ),
      ]),
    ]);

    const card = await screen.findByRole("button", {
      name: "Slideshow from Pick 26a · 1922 · 2 lei",
    });
    act(() => card.focus());

    fireEvent.keyDown(card, { key: "ArrowRight", shiftKey: true });

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(card).toHaveFocus();
    expect(
      screen.getByRole("button", {
        name: "Slideshow from Pick 27a · 1923 · 3 lei",
      }),
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
        entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE],
            primary: OWNED_NOTE.id,
          },
          1,
        ),
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
      screen.getByRole("button", { name: "Slideshow from Pick 22a · 1917 · 1 leu" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Pick 25d · 1921 · 10 lei is unseen. Replace with note",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Seen/ }));
    expect(screen.getByText("No seen cards.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Slideshow from Pick 22a · 1917 · 1 leu" }),
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
    // The other specimen is a seen reference, so the entry drops to Seen.
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

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
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
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
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
      screen.getByRole("button", { name: "Actions for Pick 22a" }),
    );
    const menu = screen.getByRole("menu", { name: "Actions for Pick 22a" });
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

  test("Slideshow lists only owned entries and uses the primary", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(screen.getByRole("button", { name: "Slideshow" }));

    const slideshow = await screen.findByRole("dialog", { name: "1 leu" });
    expect(
      within(slideshow).getByText(/1 of 2/),
    ).toBeInTheDocument();
    // The seen entry's note is skipped entirely.
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
          name: "Slideshow from Pick 22a · 1917 · 1 leu",
        }),
      ).toHaveFocus(),
    );
  });

  test("keeps the check when the primary is a seen reference", async () => {
    const tree = [
      categoryNode([
        entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE, REFERENCE_NOTE],
            primary: REFERENCE_NOTE.id,
          },
          1,
        ),
      ]),
    ];
    await openShowcase(tree);

    expect(
      screen.getByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
      }),
    ).toBeInTheDocument();  });

  test("a complete catalog wears the Complete chip", async () => {
    const tree = [
      categoryNode([
        entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE],
            primary: OWNED_NOTE.id,
          },
          1,
        ),
      ]),
    ];
    const { container } = await openShowcase(tree);

    expect(summary(container)).toHaveTextContent("Complete");
    expect(
      screen.queryByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is seen. Mark as owned",
      }),
    ).not.toBeInTheDocument();
  });

  test("a note leaf in a catalog gets the state treatment but no manager", async () => {
    const user = userEvent.setup();
    const tree = [
      categoryNode([
        entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE],
            primary: OWNED_NOTE.id,
          },
          1,
        ),
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
      await screen.findByRole("button", { name: "Add to this level" }),
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
        "1921 · 100 lei",
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
