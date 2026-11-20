import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase shell tests render the real sidebar and routes with the web API
// mocked. A showcase is one always-editable view now, so these tests cover the
// header actions, immediate creation, and deletion rather than the retired
// draft canvas.
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
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCollection: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
  replaceCatalogEntryWithNote: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
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
  createShowcase,
  deleteShowcase,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  renameShowcase,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { CATALOG_ROUTES, SHOWCASE_ROUTES } from "./lib/routes.js";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <CollectionsProvider>
        <ShowcasesProvider>
          <ShellContent />
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

function currentPath() {
  return screen.getByTestId("pathname").textContent;
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
      { id: 1, name: "Summer" },
      { id: 2, name: "Vienna" },
    ],
  });
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [] });
  getCategories.mockResolvedValue({ categories: [] });
  createShowcase.mockResolvedValue({
    showcase: { id: 9, name: "Showcase" },
  });
});

describe("Showcases sidebar section", () => {
  test("lists one item per showcase and a New showcase action", async () => {
    renderAt(CATALOG_ROUTES.collection(1));

    expect(
      await screen.findByRole("link", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vienna" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New showcase" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showcases")).toBeInTheDocument();
  });

  test("marks the open showcase as the current page", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(2));

    const vienna = await screen.findByRole("link", { name: "Vienna" });
    expect(vienna).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Summer" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("Creating a showcase", () => {
  test("New showcase posts immediately and opens the one editable view", async () => {
    const user = userEvent.setup();
    renderAt(CATALOG_ROUTES.collection(1));

    await user.click(
      await screen.findByRole("button", { name: "New showcase" }),
    );

    await waitFor(() => {
      expect(createShowcase).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(9));
    });
    expect(
      await screen.findByRole("link", { name: "Showcase" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename showcase: Showcase" }),
    ).toBeInTheDocument();
  });
});

describe("Showcase view", () => {
  test("renders the empty-showcase message and create-category tile", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New category" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename showcase: Summer" }),
    ).toBeInTheDocument();
  });

  test("the retired edit route redirects to the same always-editable view", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcaseEdit(1)}?node=20`);

    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(1));
    });
    expect(
      await screen.findByRole("button", { name: "Rename showcase: Summer" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  test("the toolbar counts the notes in the loaded tree", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
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
          children: [
            {
              id: 40,
              node_type: "note",
              name: null,
              parent_node_id: 10,
              note_id: 100,
              note: { id: 100, denomination: "1", issue_date: "1917" },
              cover_note: null,
              children: [],
            },
            {
              id: 41,
              node_type: "note",
              name: null,
              parent_node_id: 10,
              note_id: 101,
              note: { id: 101, denomination: "5", issue_date: "1920" },
              cover_note: null,
              children: [],
            },
          ],
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("button", { name: "All (2)" }),
    ).toBeInTheDocument();
  });
});

describe("Renaming a showcase", () => {
  test("the title opens the rename form and Save updates the sidebar", async () => {
    const user = userEvent.setup();
    renameShowcase.mockResolvedValue({
      showcase: { id: 1, name: "Winter", display_order: 1 },
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("link", { name: "Summer" });
    await user.click(
      screen.getByRole("button", { name: "Rename showcase: Summer" }),
    );
    const field = screen.getByLabelText("Showcase name");
    await user.clear(field);
    await user.type(field, "Winter");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(renameShowcase).toHaveBeenCalledWith(1, "Winter");
    });
    expect(
      await screen.findByRole("link", { name: "Winter" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Summer" }),
    ).not.toBeInTheDocument();
  });

  test("Enter also saves the name", async () => {
    const user = userEvent.setup();
    renameShowcase.mockResolvedValue({
      showcase: { id: 1, name: "Spring", display_order: 1 },
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("link", { name: "Summer" });
    await user.click(
      screen.getByRole("button", { name: "Rename showcase: Summer" }),
    );
    const field = screen.getByLabelText("Showcase name");
    await user.clear(field);
    await user.type(field, "Spring{Enter}");

    await waitFor(() => {
      expect(renameShowcase).toHaveBeenCalledWith(1, "Spring");
    });
  });

  test("Cancel closes the form without renaming", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("link", { name: "Summer" });
    await user.click(
      screen.getByRole("button", { name: "Rename showcase: Summer" }),
    );
    const field = screen.getByLabelText("Showcase name");
    await user.clear(field);
    await user.type(field, "Winter");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(renameShowcase).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Rename showcase: Summer" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Showcase name")).not.toBeInTheDocument();
  });
});

describe("Deleting a showcase", () => {
  async function openDeleteConfirmation(user) {
    await user.click(
      await screen.findByRole("button", { name: "Showcase actions" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete showcase…" }),
    );
    return screen.findByRole("dialog");
  }

  test("confirms, deletes, and opens the next showcase in order", async () => {
    const user = userEvent.setup();
    deleteShowcase.mockResolvedValue({ success: true });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const dialog = await openDeleteConfirmation(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteShowcase).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(2));
    });
  });

  test("deleting the last remaining showcase goes to the first collection", async () => {
    const user = userEvent.setup();
    getShowcases.mockResolvedValue({ showcases: [{ id: 1, name: "Only" }] });
    deleteShowcase.mockResolvedValue({ success: true });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const dialog = await openDeleteConfirmation(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.collection(1));
    });
  });

  test("cancelling the confirmation keeps the showcase", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const dialog = await openDeleteConfirmation(user);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(deleteShowcase).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Retired routes", () => {
  test("/portfolio/categories falls through to the first collection", async () => {
    renderAt("/portfolio/categories");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.collection(1));
    });
    expect(await screen.findByText("Collection screen")).toBeInTheDocument();
  });

  test("/portfolio/groupings falls through to the first collection", async () => {
    renderAt("/portfolio/groupings");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.collection(1));
    });
    expect(await screen.findByText("Collection screen")).toBeInTheDocument();
  });
});
