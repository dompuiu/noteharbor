import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase screenshot tests render the real shell (sidebar + routes) with
// the web API mocked. The other screens are stubbed so assertions land on the
// showcase behaviour, not on their unrelated data loads.
vi.mock("./lib/api.js", () => ({
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
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCollection: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
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
    renderAt(CATALOG_ROUTES.banknotes);

    expect(await screen.findByRole("link", { name: "Summer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vienna" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New showcase" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showcases")).toBeInTheDocument();
  });

  test("marks the open showcase as the current page, including in edit mode", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(2));

    const vienna = await screen.findByRole("link", { name: "Vienna" });
    expect(vienna).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Summer" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("Creating a showcase", () => {
  test("posts a showcase and opens its edit route with the name field focused", async () => {
    const user = userEvent.setup();
    renderAt(CATALOG_ROUTES.banknotes);

    await user.click(
      await screen.findByRole("button", { name: "New showcase" }),
    );

    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcaseEdit(9));
    });
    expect(createShowcase).toHaveBeenCalled();

    const nameField = await screen.findByLabelText("Showcase name");
    await waitFor(() => {
      expect(nameField).toHaveFocus();
    });
  });
});

describe("Showcase modes", () => {
  test("the view route renders the empty-showcase message", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
  });

  test("the edit route renders the prototype empty-state box and a name field", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const copy = await screen.findByText(
      "No categories yet. Reuse a label or create a new one.",
    );
    expect(copy.closest(".showcase-empty-box")).not.toBeNull();
    // The box owns the only create-category tile (no duplicate in the grid).
    expect(
      screen.getAllByRole("button", { name: "Create a category" }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Showcase name")).toBeInTheDocument();
  });

  test("drilling into a new (empty) category shows the dashed empty box with add tiles", async () => {
    const user = userEvent.setup();
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
          id: 10,
          node_type: "category",
          name: "Fresh",
          category_id: 1,
          parent_node_id: null,
          note_id: null,
          cover_note_id: null,
          position: 1,
          note: null,
          cover_note: null,
          children: [],
        },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Open category Fresh" }),
    );

    const message = await screen.findByText("No notes here yet.");
    expect(message.closest(".showcase-empty-box")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Add notes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create a grouping" }),
    ).toBeInTheDocument();
  });

  test("the view header links to edit and the edit header links back", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(await screen.findByRole("link", { name: "Edit" }));
    expect(currentPath()).toBe(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(await screen.findByRole("link", { name: "View" }));
    expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(1));
  });

  test("the header shows the total note count of the loaded tree", async () => {
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

    expect(await screen.findByText("2 notes")).toBeInTheDocument();
  });
});

describe("Renaming a showcase", () => {
  test("saves the edit header name and updates the sidebar item", async () => {
    const user = userEvent.setup();
    renameShowcase.mockResolvedValue({
      showcase: { id: 1, name: "Winter", display_order: 1 },
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    // The field must show the loaded showcase before it is edited.
    await screen.findByRole("link", { name: "Summer" });
    const field = screen.getByLabelText("Showcase name");
    await user.clear(field);
    await user.type(field, "Winter{Enter}");

    await waitFor(() => {
      expect(renameShowcase).toHaveBeenCalledWith(1, "Winter");
    });
    expect(await screen.findByRole("link", { name: "Winter" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Summer" }),
    ).not.toBeInTheDocument();
    expect(field).toHaveValue("Winter");
  });

  test("editing the name field and leaving it also saves", async () => {
    const user = userEvent.setup();
    renameShowcase.mockResolvedValue({
      showcase: { id: 1, name: "Spring", display_order: 1 },
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("link", { name: "Summer" });
    const field = screen.getByLabelText("Showcase name");
    await user.clear(field);
    await user.type(field, "Spring");
    await user.tab();

    await waitFor(() => {
      expect(renameShowcase).toHaveBeenCalledWith(1, "Spring");
    });
  });
});

describe("Deleting a showcase", () => {
  test("confirms, deletes, and opens the next showcase in order", async () => {
    const user = userEvent.setup();
    deleteShowcase.mockResolvedValue({ success: true });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Delete showcase" }),
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteShowcase).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcaseEdit(2));
    });
  });

  test("deleting the last remaining showcase goes to Banknotes", async () => {
    const user = userEvent.setup();
    getShowcases.mockResolvedValue({ showcases: [{ id: 1, name: "Only" }] });
    deleteShowcase.mockResolvedValue({ success: true });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Delete showcase" }),
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
  });

  test("cancelling the confirmation keeps the showcase", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await user.click(
      await screen.findByRole("button", { name: "Delete showcase" }),
    );

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(deleteShowcase).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog"),
    ).not.toBeInTheDocument();
  });
});

describe("Retired routes", () => {
  test("/portfolio/categories falls through to Banknotes", async () => {
    renderAt("/portfolio/categories");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });

  test("/portfolio/groupings falls through to Banknotes", async () => {
    renderAt("/portfolio/groupings");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });
});
