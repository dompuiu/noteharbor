import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase category tests render the real shell (sidebar + routes) with the
// web API mocked. The other screens are stubbed so the assertions land on the
// showcase canvas, not their unrelated data loads.
vi.mock("./lib/api.js", () => ({
  createCatalogEntry: vi.fn(),
  createCategory: vi.fn(),
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  createShowcaseNode: vi.fn(),
  deleteCategory: vi.fn(),
  deleteCollection: vi.fn(),
  deleteNode: vi.fn(),
  duplicateNode: vi.fn(),
  getCategories: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
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
  createCategory,
  createShowcaseNode,
  deleteCategory,
  deleteNode,
  duplicateNode,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  reorderNodes,
  updateNode,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

const SUMMER_NODE = {
  id: 10,
  node_type: "category",
  name: "Summer",
  category_id: 1,
  parent_node_id: null,
  note_id: null,
  cover_note_id: null,
  position: 1,
  note: null,
  children: [],
};

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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Default" }],
  });
  getShowcases.mockResolvedValue({
    showcases: [{ id: 1, name: "My showcase" }],
  });
  getCategories.mockResolvedValue({
    categories: [
      { id: 1, name: "Summer", showcase_count: 1 },
      { id: 2, name: "Vienna", showcase_count: 0 },
    ],
  });
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [SUMMER_NODE] });
  createCategory.mockResolvedValue({ category: { id: 5, name: "Winter" } });
  createShowcaseNode.mockResolvedValue({
    node: {
      id: 50,
      node_type: "category",
      name: "Winter",
      category_id: 5,
      parent_node_id: null,
      position: 2,
      children: [],
    },
  });
  updateNode.mockResolvedValue({
    node: { ...SUMMER_NODE, name: "Monsoon" },
  });
  deleteNode.mockResolvedValue({ success: true });
});

describe("the showcase category canvas", () => {
  test("shows an expanded section per top-level category", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("0 entries")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New category" }),
    ).toBeInTheDocument();
  });

  test("shows the expanded section and the add tile", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
          ...SUMMER_NODE,
          children: [
            {
              id: 40,
              node_type: "note",
              name: null,
              category_id: null,
              parent_node_id: 10,
              note_id: 100,
              cover_note_id: null,
              position: 1,
              note: { id: 100, denomination: "1", issue_date: "2020" },
              cover_note: null,
              children: [],
            },
          ],
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New category" }),
    ).toBeInTheDocument();
  });

  test("view mode prints the direct entry and grouping counts under the title", async () => {
    const note = {
      id: 40,
      node_type: "note",
      name: null,
      category_id: null,
      parent_node_id: 10,
      note_id: 100,
      cover_note_id: null,
      position: 1,
      note: { id: 100, denomination: "1", issue_date: "2020" },
      cover_note: null,
      children: [],
    };
    const nestedNote = {
      ...note,
      id: 42,
      parent_node_id: 41,
      note_id: 101,
      note: { id: 101, denomination: "2", issue_date: "2021" },
    };
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
          ...SUMMER_NODE,
          children: [
            note,
            {
              id: 41,
              node_type: "grouping",
              name: "Proofs",
              category_id: null,
              parent_node_id: 10,
              note_id: null,
              cover_note_id: 101,
              position: 2,
              note: null,
              cover_note: null,
              children: [nestedNote],
            },
          ],
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(await screen.findByText("1 entry · 1 grouping")).toBeInTheDocument();
  });

  test("drops a count that is zero from the section meta", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
          ...SUMMER_NODE,
          children: [
            {
              id: 40,
              node_type: "note",
              name: null,
              category_id: null,
              parent_node_id: 10,
              note_id: 100,
              cover_note_id: null,
              position: 1,
              note: { id: 100, denomination: "1", issue_date: "2020" },
              cover_note: null,
              children: [],
            },
          ],
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(await screen.findByText("1 entry")).toBeInTheDocument();
    expect(screen.queryByText(/groupings?$/)).not.toBeInTheDocument();
  });

  test("keeps an empty category visible so it can be filled", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
  });

  test("adding a typed name creates the placement immediately", async () => {
    const user = userEvent.setup();
    createShowcaseNode.mockResolvedValue({
      node: {
        id: 50,
        node_type: "category",
        name: "Winter",
        category_id: 5,
        parent_node_id: null,
        position: 2,
        children: [],
      },
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New category" }))
      .toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Category name"), "Winter");
    await user.click(
      within(dialog).getByRole("button", { name: "Add category" }),
    );

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "category",
        name: "Winter",
      });
    });
    expect(
      await screen.findByRole("heading", { name: "Winter" }),
    ).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();
  });

  test("keyboard navigates suggestions and Enter fills the field", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    const input = screen.getByLabelText("Category name");
    await user.type(input, "v");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(input).toHaveValue("Vienna");
    // Picking fills the field only; staging still waits for Add category.
    expect(createShowcaseNode).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("heading", { name: "Vienna" }),
    ).not.toBeInTheDocument();
  });

  test("deleting an unused suggestion removes it from the pool list", async () => {
    const user = userEvent.setup();
    deleteCategory.mockResolvedValue({ success: true });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    await user.type(screen.getByLabelText("Category name"), "v");
    await user.keyboard("{ArrowDown}");

    await user.click(
      screen.getByRole("button", {
        name: "Delete Vienna from the category pool",
      }),
    );

    await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith(2));
    expect(
      screen.queryByRole("option", { name: "Vienna" }),
    ).not.toBeInTheDocument();
  });

  test("a refused delete keeps the suggestion and shows the message", async () => {
    const user = userEvent.setup();
    deleteCategory.mockRejectedValue(
      new Error("This category is placed in 2 showcases."),
    );
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    await user.type(screen.getByLabelText("Category name"), "v");
    await user.keyboard("{ArrowDown}");

    await user.click(
      screen.getByRole("button", {
        name: "Delete Vienna from the category pool",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This category is placed in 2 showcases.",
    );
    expect(screen.getByRole("option", { name: "Vienna" })).toBeInTheDocument();
  });

  test("suggestions stay hidden until ArrowDown opens them", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );

    // Like the tags field: the list opens on demand, not with the field.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");

    expect(
      await screen.findByRole("option", { name: "Vienna" }),
    ).toBeInTheDocument();
  });

  test("suggestions float above the page instead of pushing content", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    await user.keyboard("{ArrowDown}");

    const listbox = await screen.findByRole("listbox");
    // Portaled to the body with fixed positioning, so opening it never
    // shifts the Add/Cancel actions below the field.
    expect(listbox.parentElement).toBe(document.body);
    expect(listbox).toHaveStyle({ position: "fixed" });
  });

  test("Escape in the field closes the tile like Cancel", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "New category" }),
    );
    // The list is open; Esc skips dismissing just the list and closes
    // the whole tile instead.
    await user.keyboard("{ArrowDown}");
    expect(
      await screen.findByRole("option", { name: "Vienna" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(
      screen.queryByLabelText("Category name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New category" }),
    ).toBeInTheDocument();
  });
  test("renaming a category writes immediately from its menu", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Rename category…" }),
    );
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Monsoon");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(10, { name: "Monsoon" });
    });
    expect(
      await screen.findByRole("heading", { name: "Monsoon" }),
    ).toBeInTheDocument();
  });

  test("the rename dialog offers the category pool and adopts a picked label", async () => {
    const user = userEvent.setup();
    updateNode.mockResolvedValueOnce({
      node: { ...SUMMER_NODE, name: "Vienna", category_id: 2 },
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Rename category…" }),
    );
    await user.click(screen.getByLabelText("Name"));

    // The pool is the same list the New category dialog offers; the label this
    // showcase already places is not a choice.
    expect(
      await screen.findByRole("option", { name: "Vienna" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /^Summer/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "Vienna" }));
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(10, { name: "Vienna" });
    });
    expect(
      await screen.findByRole("heading", { name: "Vienna" }),
    ).toBeInTheDocument();
  });

  test("a rename failure shows once, inside the dialog", async () => {
    const user = userEvent.setup();
    updateNode.mockRejectedValueOnce(
      new Error("This category is already in the showcase."),
    );
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Rename category…" }),
    );
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Winter");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(
        screen.getAllByText("This category is already in the showcase."),
      ).toHaveLength(1);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("removing a category confirms and deletes immediately", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Remove category…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteNode).toHaveBeenCalledWith(10);
    });
    expect(
      screen.queryByRole("heading", { name: "Summer" }),
    ).not.toBeInTheDocument();
  });

  test("moving a category down persists the root order immediately", async () => {
    const user = userEvent.setup();
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        SUMMER_NODE,
        {
          ...SUMMER_NODE,
          id: 11,
          name: "Winter",
          category_id: 2,
          position: 2,
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("heading", { name: "Summer" });
    await user.click(screen.getByRole("button", { name: "Actions for Summer" }));
    await user.click(screen.getByRole("menuitem", { name: "Move down" }));

    await waitFor(() => {
      expect(reorderNodes).toHaveBeenCalledWith(1, null, [11, 10]);
    });
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Winter", "Summer"]);
  });

  test("a category section exposes its own actions menu", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        SUMMER_NODE,
        {
          ...SUMMER_NODE,
          id: 11,
          name: "Winter",
          category_id: 2,
          position: 2,
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("heading", { name: "Summer" });
    expect(
      screen.getByRole("button", { name: "Actions for Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for Winter" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Move Summer/ }),
    ).not.toBeInTheDocument();
  });

  test("the duplicate item is disabled when there is no other showcase", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Duplicate to showcase…" }),
    ).toBeDisabled();
  });

  test("duplicates a category into another showcase and confirms with a toast", async () => {
    const user = userEvent.setup();
    getShowcases.mockResolvedValue({
      showcases: [
        { id: 1, name: "My showcase", entry_count: 3 },
        { id: 2, name: "Second", entry_count: 0 },
        { id: 3, name: "Third", entry_count: 2 },
      ],
    });
    getShowcaseTree.mockImplementation(async (id) => {
      if (id === 1) {
        return { showcase_id: 1, nodes: [SUMMER_NODE] };
      }
      if (id === 3) {
        return { showcase_id: 3, nodes: [{ ...SUMMER_NODE, id: 30 }] };
      }
      return { showcase_id: id, nodes: [] };
    });
    duplicateNode.mockResolvedValue({
      node: {
        id: 70,
        node_type: "category",
        name: "Summer",
        category_id: 1,
        parent_node_id: null,
        position: 1,
        children: [],
      },
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate to showcase…" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText("Already in this showcase"),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: /Third/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /Second/ })).toBeChecked();
    expect(within(dialog).getByText("0 entries")).toBeInTheDocument();
    expect(within(dialog).getByText("2 entries")).toBeInTheDocument();

    const duplicateButton = within(dialog).getByRole("button", {
      name: "Duplicate",
    });
    await waitFor(() => expect(duplicateButton).toBeEnabled());
    await user.click(duplicateButton);

    await waitFor(() => {
      expect(duplicateNode).toHaveBeenCalledWith(10, 2);
    });
    expect(
      await screen.findByText("Duplicated Summer to Second"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
  });

  test("a refused duplicate keeps the dialog open and shows the message", async () => {
    const user = userEvent.setup();
    getShowcases.mockResolvedValue({
      showcases: [
        { id: 1, name: "My showcase", entry_count: 3 },
        { id: 2, name: "Second", entry_count: 0 },
      ],
    });
    getShowcaseTree.mockImplementation(async (id) =>
      id === 1
        ? { showcase_id: 1, nodes: [SUMMER_NODE] }
        : { showcase_id: id, nodes: [] },
    );
    duplicateNode.mockRejectedValue(
      new Error("This category is already in the showcase."),
    );
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", { name: "Actions for Summer" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate to showcase…" }),
    );

    const dialog = await screen.findByRole("dialog");
    const duplicateButton = within(dialog).getByRole("button", {
      name: "Duplicate",
    });
    await waitFor(() => expect(duplicateButton).toBeEnabled());
    await user.click(duplicateButton);

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This category is already in the showcase.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
