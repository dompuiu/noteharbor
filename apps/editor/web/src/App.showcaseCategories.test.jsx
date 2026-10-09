import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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
  test("edit mode shows a name-only card per top-level category", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a category" }),
    ).toBeInTheDocument();
  });

  test("view mode shows the read-only card and no add tile", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create a category" }),
    ).not.toBeInTheDocument();
  });

  test("adding a typed name creates the label and places it", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Create a category" }),
    );
    await user.type(screen.getByLabelText("Category name"), "Winter");
    await user.click(screen.getByRole("button", { name: "Add category" }));

    expect(createCategory).toHaveBeenCalledWith("Winter");
    expect(createShowcaseNode).toHaveBeenCalledWith(1, {
      type: "category",
      category_id: 5,
    });
    expect(
      await screen.findByRole("button", { name: "Open category Winter" }),
    ).toBeInTheDocument();
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

  test("renaming a placement renames the shared label", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Rename Summer" }),
    );
    const input = screen.getByLabelText("New name for Summer");
    await user.clear(input);
    await user.type(input, "Monsoon");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateNode).toHaveBeenCalledWith(10, { name: "Monsoon" });
    expect(
      await screen.findByRole("button", { name: "Open category Monsoon" }),
    ).toBeInTheDocument();
  });

  test("removing a placement drops it and keeps the add tile", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Remove Summer" }),
    );

    expect(deleteNode).toHaveBeenCalledWith(10);
    expect(
      screen.queryByRole("button", { name: "Open category Summer" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a category" }),
    ).toBeInTheDocument();
  });
});
