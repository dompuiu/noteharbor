import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The photo-size tests render the real shell at a showcase route with the web
// API mocked. The other screens are stubbed so the assertions land on the
// showcase header control and its shared grid.
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
import { getCategories, getCollections, getHealth, getShowcases, getShowcaseTree } from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

const PHOTO_SIZE_STORAGE_KEY = "noteharbor.showcasePhotoSize";

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

function photoSizeGroup() {
  return within(screen.getByRole("group", { name: "Photo size" }));
}

function gridMinWidth() {
  return screen
    .getAllByTestId("showcase-grid")[0]
    .style.getPropertyValue("--showcase-card-min");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Default" }],
  });
  getShowcases.mockResolvedValue({ showcases: [{ id: 1, name: "Summer" }] });
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
            id: 11,
            node_type: "note",
            name: null,
            category_id: null,
            parent_node_id: 10,
            note_id: 100,
            cover_note_id: null,
            position: 1,
            note: { id: 100, denomination: "1", issue_date: "1917", images: [] },
            cover_note: null,
            children: [],
          },
        ],
      },
    ],
  });
  getCategories.mockResolvedValue({ categories: [] });
});

describe("the showcase photo size control", () => {
  test("offers Small, Medium, and Large with Small the default", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const group = await screen.findByRole("group", { name: "Photo size" });
    expect(within(group).getByRole("radio", { name: "Small" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Medium" })).not.toBeChecked();
    expect(within(group).getByRole("radio", { name: "Large" })).not.toBeChecked();
    expect(gridMinWidth()).toBe("200px");
  });

  test("resizes the grid and is remembered across a reload", async () => {
    const user = userEvent.setup();
    const view = renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("group", { name: "Photo size" });
    await user.click(photoSizeGroup().getByRole("radio", { name: "Large" }));

    expect(gridMinWidth()).toBe("480px");
    expect(window.localStorage.getItem(PHOTO_SIZE_STORAGE_KEY)).toBe("large");

    // Simulate a reload: remount against the same browser storage.
    view.unmount();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("group", { name: "Photo size" });
    expect(photoSizeGroup().getByRole("radio", { name: "Large" })).toBeChecked();
    expect(gridMinWidth()).toBe("480px");
  });

  test("resizes the grid in edit mode too", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("group", { name: "Photo size" });
    await user.click(photoSizeGroup().getByRole("radio", { name: "Medium" }));

    expect(gridMinWidth()).toBe("320px");
  });

  test("an unknown remembered value falls back to Small", async () => {
    window.localStorage.setItem(PHOTO_SIZE_STORAGE_KEY, "gigantic");
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("group", { name: "Photo size" });
    expect(photoSizeGroup().getByRole("radio", { name: "Small" })).toBeChecked();
    expect(gridMinWidth()).toBe("200px");
  });
});
