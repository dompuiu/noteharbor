import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The catalog checklist tests drive the real shell (sidebar + routes) with the
// web API mocked. The other screens are stubbed so the assertions land on the
// showcase canvas, the ownership menu, the finder, and Present.
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

function note(id, { owned = true, denomination, catalog_number, issue_date }) {
  return {
    collection_id: 1,
    id,
    catalog_number,
    denomination,
    issue_date,
    images: [FRONT(id)],
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
  return container.querySelector(".showcase-summary");
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
      screen.queryByRole("button", { name: "Present" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1 notes")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 leu, Pick 22a, 1917" }),
    ).toBeInTheDocument();
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
    expect(summary(container)).toHaveTextContent("2 owned");
    expect(summary(container)).toHaveTextContent("1 seen");
    expect(summary(container)).toHaveTextContent("1 unseen");
    expect(summary(container)).toHaveTextContent("50%");

    // Owned: primary photo, a Present action, and the ownership check.
    expect(
      screen.getByRole("button", { name: "Present 1 leu · Pick 22a · 1917" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
      }),
    ).toBeInTheDocument();
    // Seen: the same photo treatment plus the SEEN tag and its footer menu.
    expect(
      screen.getByRole("button", {
        name: "5 lei · Pick 24c · 1920 is seen. Open ownership options",
      }),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".showcase-seen-tag"),
    ).toHaveTextContent("Seen");
    // Unseen: the neutral well and the whole card opening the finder.
    expect(
      screen.getByRole("button", {
        name: "10 lei · Pick 25d · 1921 is unseen. Add notes",
      }),
    ).toBeInTheDocument();

    // The multi-specimen strip stays quiet and names the primary.
    expect(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    ).toHaveTextContent("2 notes · primary");
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
      screen.getByRole("button", { name: "Present 1 leu · Pick 22a · 1917" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "10 lei · Pick 25d · 1921 is unseen. Add notes",
      }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Seen/ }));
    expect(screen.getByText("No seen cards.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Present 1 leu · Pick 22a · 1917" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(
      screen.getByRole("button", {
        name: "10 lei · Pick 25d · 1921 is unseen. Add notes",
      }),
    ).toBeInTheDocument();
  });

  test("the ownership menu marks the displayed note and Undo restores it", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
      }),
    );

    const menu = screen.getByRole("menu", {
      name: "Ownership options for 1 leu · Pick 22a · 1917",
    });
    expect(within(menu).getByText("Owned")).toBeInTheDocument();
    expect(
      within(menu).getByText("Mark this note as not owned"),
    ).toBeInTheDocument();
    expect(
      within(menu).getByText("1 leu · Pick 22a · 1917"),
    ).toBeInTheDocument();

    await user.click(
      within(menu).getByRole("menuitem", {
        name: /Mark this note as not owned/,
      }),
    );

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalledWith(
      OWNED_NOTE.id,
      expect.objectContaining({ owned: false }),
      1,
    );
    // The other specimen is a seen reference, so the entry drops to Seen.
    expect(
      await screen.findByRole("button", {
        name: "1 leu · Pick 22a · 1917 is seen. Open ownership options",
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

  test("an unseen card opens the finder and picking an owned note fills it", async () => {
    const user = userEvent.setup();
    updateNodeNotes.mockResolvedValue({
      node: entryNode(
        22,
        {
          catalog_number: "25d",
          denomination: "10 lei",
          issue_date: "1921",
          specimens: [PICKER_NOTE],
          primary: PICKER_NOTE.id,
        },
        3,
      ),
    });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "10 lei · Pick 25d · 1921 is unseen. Add notes",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    expect(
      within(dialog).getByText("Add notes to “Pick 25d”"),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("checkbox", { name: /10 lei/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add & close" }),
    );

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(22, {
        note_ids: [PICKER_NOTE.id],
        primary_note_id: PICKER_NOTE.id,
      }),
    );
    expect(
      await screen.findByRole("button", {
        name: "Present 10 lei · Pick 25d · 1921",
      }),
    ).toBeInTheDocument();
  });

  test("the ownership menu navigates by keyboard and returns focus to the check", async () => {
    const user = userEvent.setup();
    await openShowcase();

    const check = screen.getByRole("button", {
      name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
    });
    expect(check).toHaveAttribute("aria-haspopup", "menu");

    await user.click(check);
    const menu = screen.getByRole("menu", {
      name: "Ownership options for 1 leu · Pick 22a · 1917",
    });
    const items = within(menu).getAllByRole("menuitem");
    await waitFor(() => expect(items[0]).toHaveFocus());

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(check).toHaveFocus();
  });

  test("Present lists only owned entries and uses the primary", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(screen.getByRole("button", { name: "Present" }));

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
          name: "Present 1 leu · Pick 22a · 1917",
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
        name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    ).toHaveTextContent("2 notes · seen primary");
  });

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
        name: "1 leu · Pick 22a · 1917 is seen. Open ownership options",
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
      name: "5 lei · Pick 24c · 1920 is seen. Open ownership options",
    });
    await user.click(seenLeaf);

    const menu = screen.getByRole("menu", {
      name: "Ownership options for 5 lei · Pick 24c · 1920",
    });
    expect(
      within(menu).queryByRole("menuitem", { name: /Notes on this entry/ }),
    ).not.toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitem", { name: /Mark this note owned/ }),
    ).toBeInTheDocument();
  });
});

describe("the specimen manager", () => {
  test("lists the entry's specimens with chips and hands focus back to the strip", async () => {
    const user = userEvent.setup();
    await openShowcase();

    const strip = screen.getByRole("button", {
      name: "2 notes on this entry. Choose the primary",
    });
    await user.click(strip);

    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(
      within(dialog).getByRole("radio", {
        name: "1 leu reference · Pick 22a · 1917, seen",
      }),
    ).toBeInTheDocument();
    expect(
      [...dialog.querySelectorAll(".showcase-manager-chip")].map(
        (chip) => chip.textContent,
      ),
    ).toEqual(["Owned", "Seen"]);
    expect(
      within(dialog).getByRole("button", {
        name: "Remove 1 leu reference · Pick 22a · 1917 from this entry",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("status"),
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    await waitFor(() => expect(strip).toHaveFocus());
    expect(
      screen.queryByRole("dialog", { name: "Notes on Pick 22a" }),
    ).not.toBeInTheDocument();
  });

  test("promotes a new primary and Undo restores the previous one", async () => {
    const user = userEvent.setup();
    updateNodeNotes
      .mockResolvedValueOnce({
        node: entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE, REFERENCE_NOTE],
            primary: REFERENCE_NOTE.id,
          },
          1,
        ),
      })
      .mockResolvedValueOnce({
        node: entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE, REFERENCE_NOTE],
            primary: OWNED_NOTE.id,
          },
          1,
        ),
      });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });

    await user.click(
      within(dialog).getByRole("radio", {
        name: "1 leu reference · Pick 22a · 1917, seen",
      }),
    );

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(20, {
        note_ids: [OWNED_NOTE.id, REFERENCE_NOTE.id],
        primary_note_id: REFERENCE_NOTE.id,
      }),
    );
    expect(
      within(dialog).getByRole("radio", {
        name: "1 leu reference · Pick 22a · 1917, seen",
      }),
    ).toBeChecked();

    const strip = await screen.findByRole("button", {
      name: "2 notes on this entry. Choose the primary",
    });
    expect(strip).toHaveTextContent("seen primary");
    // The card and the slideshow both read the primary, so the promoted
    // reference is now the image behind them.
    expect(
      screen
        .getByRole("button", { name: "Present 1 leu · Pick 22a · 1917" })
        .querySelector("img")
        .getAttribute("src"),
    ).toContain(`/notes/${REFERENCE_NOTE.id}/`);

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(updateNodeNotes).toHaveBeenCalledTimes(2));
    expect(updateNodeNotes).toHaveBeenLastCalledWith(20, {
      note_ids: [OWNED_NOTE.id, REFERENCE_NOTE.id],
      primary_note_id: OWNED_NOTE.id,
    });
    expect(
      within(dialog).getByRole("radio", {
        name: "1 leu · Pick 22a · 1917, owned",
      }),
    ).toBeChecked();
    expect(
      screen
        .getByRole("button", { name: "Present 1 leu · Pick 22a · 1917" })
        .querySelector("img")
        .getAttribute("src"),
    ).toContain(`/notes/${OWNED_NOTE.id}/`);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "2 notes on this entry. Choose the primary",
        }),
      ).toHaveTextContent("2 notes · primary"),
    );
  });

  test("removing the primary reflects the server's promotion", async () => {
    const user = userEvent.setup();
    updateNodeNotes
      .mockResolvedValueOnce({
        node: entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [REFERENCE_NOTE],
            primary: REFERENCE_NOTE.id,
          },
          1,
        ),
      })
      .mockResolvedValueOnce({
        node: entryNode(
          20,
          {
            catalog_number: "22a",
            specimens: [OWNED_NOTE, REFERENCE_NOTE],
            primary: OWNED_NOTE.id,
          },
          1,
        ),
      });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: /Notes on this entry \(2\)/ }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "Remove 1 leu · Pick 22a · 1917 from this entry",
      }),
    );

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(20, {
        note_ids: [REFERENCE_NOTE.id],
        primary_note_id: REFERENCE_NOTE.id,
      }),
    );
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(1);
    expect(radios[0]).toBeChecked();
    expect(radios[0]).toHaveAccessibleName(
      "1 leu reference · Pick 22a · 1917, seen",
    );

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    // One unowned specimen: the entry is Seen, and the strip is gone.
    expect(
      await screen.findByRole("button", {
        name: "1 leu · Pick 22a · 1917 is seen. Open ownership options",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /notes on this entry\. Choose the primary/,
      }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(updateNodeNotes).toHaveBeenCalledTimes(2));
    expect(updateNodeNotes).toHaveBeenLastCalledWith(20, {
      note_ids: [OWNED_NOTE.id, REFERENCE_NOTE.id],
      primary_note_id: OWNED_NOTE.id,
    });
    expect(
      await screen.findByRole("button", {
        name: "1 leu · Pick 22a · 1917 is owned. Open ownership options",
      }),
    ).toBeInTheDocument();
  });

  test("adds a note from the embedded finder and hides it from the next search", async () => {
    const user = userEvent.setup();
    getAllNotes.mockResolvedValue({ notes: [PICKER_NOTE] });
    updateNodeNotes.mockResolvedValueOnce({
      node: entryNode(
        20,
        {
          catalog_number: "22a",
          specimens: [OWNED_NOTE, REFERENCE_NOTE, PICKER_NOTE],
          primary: OWNED_NOTE.id,
        },
        1,
      ),
    });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });

    await user.click(
      await within(dialog).findByRole("checkbox", { name: /10 lei/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (1)" }),
    );

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(20, {
        note_ids: [OWNED_NOTE.id, REFERENCE_NOTE.id, PICKER_NOTE.id],
        primary_note_id: OWNED_NOTE.id,
      }),
    );
    expect(within(dialog).getAllByRole("radio")).toHaveLength(3);
    expect(
      within(dialog).queryByRole("checkbox", { name: /10 lei/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "3 notes on this entry. Choose the primary",
      }),
    ).toHaveTextContent("3 notes · primary");
  });

  test("the first note added to an emptied entry becomes its primary", async () => {
    const user = userEvent.setup();
    getAllNotes.mockResolvedValue({ notes: [PICKER_NOTE] });
    updateNodeNotes
      .mockResolvedValueOnce({
        node: entryNode(
          21,
          {
            catalog_number: "24c",
            denomination: "5 lei",
            issue_date: "1920",
            specimens: [],
            primary: null,
          },
          2,
        ),
      })
      .mockResolvedValueOnce({
        node: entryNode(
          21,
          {
            catalog_number: "24c",
            denomination: "5 lei",
            issue_date: "1920",
            specimens: [PICKER_NOTE],
            primary: PICKER_NOTE.id,
          },
          2,
        ),
      });
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "5 lei · Pick 24c · 1920 is seen. Open ownership options",
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: /Notes on this entry \(1\)/ }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 24c",
    });

    await user.click(
      within(dialog).getByRole("button", {
        name: "Remove 5 lei · Pick 24c · 1920 from this entry",
      }),
    );
    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(21, { note_ids: [] }),
    );

    await user.click(
      await within(dialog).findByRole("checkbox", { name: /10 lei/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (1)" }),
    );

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenLastCalledWith(21, {
        note_ids: [PICKER_NOTE.id],
        primary_note_id: PICKER_NOTE.id,
      }),
    );
    const radio = within(dialog).getByRole("radio", {
      name: "10 lei · Pick 25d · 1921, owned",
    });
    expect(radio).toBeChecked();
    await waitFor(() => expect(radio).toHaveFocus());
  });

  test("a failed write stays inside the manager and reverts the row", async () => {
    const user = userEvent.setup();
    updateNodeNotes.mockRejectedValueOnce(new Error("Server said no."));
    await openShowcase();

    await user.click(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });

    await user.click(
      within(dialog).getByRole("button", {
        name: "Remove 1 leu · Pick 22a · 1917 from this entry",
      }),
    );

    expect(
      await within(dialog).findByRole("alert"),
    ).toHaveTextContent("Server said no.");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
  });

  test("warns when an owned entry presents a seen reference", async () => {
    const user = userEvent.setup();
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

    await user.click(
      screen.getByRole("button", {
        name: "2 notes on this entry. Choose the primary",
      }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });
    const warning = within(dialog).getByRole("status");
    expect(warning).toHaveTextContent("This entry is owned");
    expect(warning).toHaveTextContent("entry stays owned");
    expect(warning).toHaveTextContent("slideshow shows that photo");
  });
});

// ── Edit mode: catalog entries are draft blocks ─────────────────────────

async function openEdit(tree = catalogTree()) {
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: tree });
  const user = userEvent.setup();
  renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
  await screen.findByLabelText("Showcase name");
  return user;
}

function editCatalogTree() {
  return [
    categoryNode([
      entryNode(
        20,
        {
          catalog_number: "22a",
          specimens: [OWNED_NOTE, REFERENCE_NOTE],
          primary: OWNED_NOTE.id,
        },
        1,
      ),
    ]),
  ];
}

describe("edit mode catalog entries", () => {
  test("Add catalog entry stages one unseen position per catalog number", async () => {
    createCatalogEntry
      .mockResolvedValueOnce({ node: { id: 501 } })
      .mockResolvedValueOnce({ node: { id: 502 } });
    const user = await openEdit([categoryNode([])]);

    await user.click(
      screen.getByRole("button", { name: "Add catalog entry" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Add catalog entries",
    });
    await user.type(
      within(dialog).getByLabelText("Catalog numbers"),
      "22a, 22b",
    );
    await user.type(within(dialog).getByLabelText("Denomination"), "20 lei");
    await user.type(within(dialog).getByLabelText("Issue date"), "1877");
    await user.type(
      within(dialog).getByLabelText("Source"),
      "Pick catalog",
    );

    // The preview repaints while the form is typed.
    expect(
      within(dialog).getByText("Pick 22a"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("2 unseen entries will be added to Summer."),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Add 2 entries" }),
    );

    // Closing the form hands focus back to the tile that opened it.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add catalog entry" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByText("20 lei · Pick 22a · 1877"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("20 lei · Pick 22b · 1877"),
    ).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(createCatalogEntry).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createCatalogEntry).toHaveBeenCalledTimes(2),
    );
    expect(createCatalogEntry).toHaveBeenNthCalledWith(1, 1, {
      parentId: 10,
      entry: {
        catalog_number: "22a",
        denomination: "20 lei",
        issue_date: "1877",
        source: "Pick catalog",
      },
      noteIds: [],
    });
    expect(createCatalogEntry).toHaveBeenNthCalledWith(2, 1, {
      parentId: 10,
      entry: {
        catalog_number: "22b",
        denomination: "20 lei",
        issue_date: "1877",
        source: "Pick catalog",
      },
      noteIds: [],
    });
  });

  test("Add notes in Catalog entries mode merges by catalog value and reports the skips", async () => {
    const MERGE_NOTE = note(202, {
      catalog_number: "22a",
      denomination: "2 lei",
      issue_date: "1917",
    });
    const NO_CATALOG_NOTE = note(203, {
      catalog_number: "",
      denomination: "3 lei",
      issue_date: "1920",
    });
    getAllNotes.mockResolvedValue({
      notes: [OWNED_NOTE, MERGE_NOTE, NO_CATALOG_NOTE],
    });
    const user = await openEdit(editCatalogTree());

    await user.click(screen.getAllByRole("button", { name: "Add notes" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });

    await user.click(
      within(dialog).getByRole("button", { name: "Catalog entries" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /2 lei · 1917/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /3 lei · 1920/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    );

    expect(
      within(dialog).getByRole("status"),
    ).toHaveTextContent(
      "Skipped 1 note with no catalog number. Add it in Notes mode instead.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getByText("3 notes · primary")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(20, {
        note_ids: [101, 102, 202],
        primary_note_id: 101,
      }),
    );
    expect(createCatalogEntry).not.toHaveBeenCalled();
  });

  test("Catalog entries mode creates an entry when no value matches", async () => {
    const user = await openEdit([categoryNode([])]);
    getAllNotes.mockResolvedValue({
      notes: [
        PICKER_NOTE,
        note(203, { catalog_number: "", denomination: "3 lei", issue_date: "1920" }),
      ],
    });
    createCatalogEntry.mockResolvedValueOnce({ node: { id: 501 } });

    await user.click(screen.getAllByRole("button", { name: "Add notes" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    await user.click(
      within(dialog).getByRole("button", { name: "Catalog entries" }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /10 lei · 1921/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /3 lei · 1920/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    );

    expect(
      within(dialog).getByRole("status"),
    ).toHaveTextContent(
      "Skipped 1 note with no catalog number. Add it in Notes mode instead.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(
      screen.getByText("10 lei · Pick 25d · 1921"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createCatalogEntry).toHaveBeenCalledWith(1, {
        parentId: 10,
        entry: {
          catalog_number: "25d",
          denomination: "10 lei",
          issue_date: "1921",
          source: "",
        },
        noteIds: [201],
      }),
    );
    expect(updateNodeNotes).not.toHaveBeenCalled();
  });

  test("editing an entry's metadata leaves the linked note alone", async () => {
    const user = await openEdit(editCatalogTree());

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit catalog entry",
    });

    expect(within(dialog).getByLabelText("Catalog number")).toHaveValue("22a");
    await user.clear(within(dialog).getByLabelText("Denomination"));
    await user.type(within(dialog).getByLabelText("Denomination"), "100 lei");
    await user.type(
      within(dialog).getByLabelText("Source"),
      "Pick catalog",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save entry" }),
    );

    // The form hands focus back to the control that opened it.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit details" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", {
        name: /100 lei · Pick 22a · 1917/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateCatalogEntry).toHaveBeenCalledWith(20, {
        catalog_number: "22a",
        denomination: "100 lei",
        issue_date: "1917",
        source: "Pick catalog",
      }),
    );
    expect(updateNote).not.toHaveBeenCalled();
    expect(updateNodeNotes).not.toHaveBeenCalled();
  });

  test("removing the primary specimen stays local until Save", async () => {
    const user = await openEdit(editCatalogTree());

    await user.click(
      screen.getByRole("button", {
        name: /1 leu · Pick 22a · 1917\. 2 notes · primary/,
      }),
    );
    const manager = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });
    expect(
      within(manager).getByText("Changes save with the showcase."),
    ).toBeInTheDocument();

    await user.click(
      within(manager).getByRole("button", {
        name: "Remove 1 leu · Pick 22a · 1917 from this entry",
      }),
    );

    expect(
      within(manager).getByText("1 leu reference · Pick 22a · 1917"),
    ).toBeInTheDocument();
    expect(updateNodeNotes).not.toHaveBeenCalled();

    await user.click(within(manager).getByRole("button", { name: "Done" }));
    expect(screen.getByText("1 note · primary")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateNodeNotes).toHaveBeenCalledWith(20, {
        note_ids: [102],
        primary_note_id: 102,
      }),
    );
  });

  test("Cancel discards a staged catalog entry", async () => {
    const user = await openEdit([categoryNode([])]);

    await user.click(
      screen.getByRole("button", { name: "Add catalog entry" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Add catalog entries",
    });
    await user.type(
      within(dialog).getByLabelText("Catalog numbers"),
      "22a",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add 1 entry" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const confirmDialog = await screen.findByRole("dialog", {
      name: "Discard changes?",
    });
    await user.click(
      within(confirmDialog).getByRole("button", { name: "Discard" }),
    );

    await screen.findByRole("heading", { name: "My showcase" });
    expect(createCatalogEntry).not.toHaveBeenCalled();
    expect(updateCatalogEntry).not.toHaveBeenCalled();
  });

  test("a staged entry's first specimen rides the creation on Save", async () => {
    getAllNotes.mockResolvedValue({ notes: [PICKER_NOTE] });
    createCatalogEntry.mockResolvedValueOnce({ node: { id: 501 } });
    const user = await openEdit([categoryNode([])]);

    await user.click(
      screen.getByRole("button", { name: "Add catalog entry" }),
    );
    const form = await screen.findByRole("dialog", {
      name: "Add catalog entries",
    });
    await user.type(within(form).getByLabelText("Catalog numbers"), "22a");
    await user.type(within(form).getByLabelText("Denomination"), "20 lei");
    await user.click(
      within(form).getByRole("button", { name: "Add 1 entry" }),
    );

    await user.click(
      screen.getByRole("button", { name: /20 lei · Pick 22a/ }),
    );
    const manager = await screen.findByRole("dialog", {
      name: "Notes on Pick 22a",
    });
    await user.click(
      within(manager).getByRole("checkbox", { name: /10 lei · 1921/ }),
    );
    await user.click(
      within(manager).getByRole("button", { name: "Add selected (1)" }),
    );
    await user.click(within(manager).getByRole("button", { name: "Done" }));

    expect(screen.getByText("1 note · primary")).toBeInTheDocument();
    expect(updateNodeNotes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(createCatalogEntry).toHaveBeenCalledWith(1, {
        parentId: 10,
        entry: {
          catalog_number: "22a",
          denomination: "20 lei",
          issue_date: "",
          source: "",
        },
        noteIds: [201],
      }),
    );
    expect(updateNodeNotes).not.toHaveBeenCalled();
  });

  test("removing a staged entry deletes it on Save", async () => {
    const user = await openEdit(editCatalogTree());

    await user.click(
      screen.getByRole("button", { name: "Remove catalog entry Pick 22a" }),
    );
    expect(
      screen.queryByRole("button", { name: /1 leu · Pick 22a/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(20));
    expect(createCatalogEntry).not.toHaveBeenCalled();
    expect(updateNodeNotes).not.toHaveBeenCalled();
  });

  test("the a shortcut never opens the note picker on an entry", async () => {
    const user = await openEdit(editCatalogTree());
    const card = screen.getByRole("button", {
      name: /1 leu · Pick 22a · 1917\. 2 notes · primary/,
    });

    card.focus();
    await user.keyboard("a");

    expect(
      screen.queryByRole("dialog", { name: "Add notes" }),
    ).not.toBeInTheDocument();
  });

  test("Tab stays inside the entry form", async () => {
    const user = await openEdit([categoryNode([])]);

    await user.click(
      screen.getByRole("button", { name: "Add catalog entry" }),
    );
    const form = await screen.findByRole("dialog", {
      name: "Add catalog entries",
    });
    expect(within(form).getByLabelText("Catalog numbers")).toHaveFocus();

    await user.tab({ shift: true });

    expect(
      within(form).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
  });
});
