import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase category tests render the real shell (sidebar + routes) with the
// web API mocked. The other screens are stubbed so the assertions land on the
// showcase canvas, not their unrelated data loads.
vi.mock("./lib/api.js", () => ({
  createCategory: vi.fn(),
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  createShowcaseNode: vi.fn(),
  deleteCollection: vi.fn(),
  deleteNode: vi.fn(),
  getCategories: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
  setDefaultCollection: vi.fn(),
  updateNode: vi.fn(),
  reorderNodes: vi.fn(),
}));

vi.mock("./components/NotesTable.jsx", () => ({
  NotesTable: () => <div>Banknotes screen</div>,
}));

vi.mock("./components/CollectionsScreen.jsx", () => ({
  CollectionsScreen: () => <div>Collections screen</div>,
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
  deleteNode,
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
      { id: 1, name: "Summer" },
      { id: 2, name: "Vienna" },
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
  test("edit mode shows an expanded section per top-level category", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a category" }),
    ).toBeInTheDocument();
  });

  test("view mode shows the expanded section and no add tile", async () => {
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
      screen.queryByRole("button", { name: "Create a category" }),
    ).not.toBeInTheDocument();
  });

  test("view mode hides an empty category", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Summer" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("No notes here yet.")).not.toBeInTheDocument();
  });

  test("adding a typed name stages the placement and saves it on Save", async () => {
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
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Create a category" }),
    );
    await user.type(screen.getByLabelText("Category name"), "Winter");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    // Staging is local: the card shows with no network calls.
    expect(
      await screen.findByRole("heading", { name: "Winter" }),
    ).toBeInTheDocument();
    expect(createCategory).not.toHaveBeenCalled();
    expect(createShowcaseNode).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save", exact: true }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "category",
        name: "Winter",
      });
    });
  });

  test("picking an existing label fills the field", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Create a category" }),
    );
    await user.click(await screen.findByRole("option", { name: "Vienna" }));

    expect(screen.getByLabelText("Category name")).toHaveValue("Vienna");
  });

  test("renaming a placement stages the rename and saves it on Save", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Rename Summer" }),
    );
    const input = screen.getByLabelText("New name for Summer");
    await user.clear(input);
    await user.type(input, "Monsoon");
    // The cell Save applies the rename to the draft only.
    const saves = screen.getAllByRole("button", { name: "Save" });
    await user.click(saves[saves.length - 1]);

    expect(
      await screen.findByRole("heading", { name: "Monsoon" }),
    ).toBeInTheDocument();
    expect(updateNode).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(10, { name: "Monsoon" });
    });
  });

  test("removing a placement stages the removal and deletes on Save", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Remove Summer" }),
    );

    expect(
      screen.queryByRole("heading", { name: "Summer" }),
    ).not.toBeInTheDocument();
    expect(deleteNode).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Create a category" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(deleteNode).toHaveBeenCalledWith(10);
    });
  });

  test("two placements show move controls with the ends disabled", async () => {
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
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("heading", { name: "Winter" });

    expect(screen.getByRole("button", { name: "Move Summer up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Summer down" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Winter up" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move Winter down" })).toBeDisabled();
  });

  test("moving a placement down stages the order and saves it on Save", async () => {
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
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Move Summer down" }),
    );

    // Staged locally: the headings swap with no network call.
    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["Winter", "Summer"]);
    expect(reorderNodes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save", exact: true }));

    await waitFor(() => {
      expect(reorderNodes).toHaveBeenCalledWith(1, null, [11, 10]);
    });
  });

  test("a single placement shows no move controls", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("heading", { name: "Summer" });

    expect(
      screen.queryByRole("button", { name: "Move Summer up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Summer down" }),
    ).not.toBeInTheDocument();
  });
});
