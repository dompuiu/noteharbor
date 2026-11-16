import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The merged Add dialog is one surface for notes and catalog shells. These tests
// drive the real shell with the web API mocked and check that picking notes
// writes immediately, with no draft Save.
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
  reorderNodes: vi.fn(),
  replaceCatalogEntryWithNote: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
  updateNodeNotes: vi.fn(),
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
  createShowcaseNode,
  getCategories,
  getCollections,
  getHealth,
  getAllNotes,
  getShowcases,
  getShowcaseTree,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

function note(overrides) {
  return {
    id: 0,
    denomination: "1 leu",
    issue_date: "1917",
    catalog_number: "22",
    images: [],
    ...overrides,
  };
}

const NOTE_A = note({ id: 101, issue_date: "1917", catalog_number: "22" });
const NOTE_B = note({ id: 102, issue_date: "1920", catalog_number: "22a" });
const NOTE_C = note({
  id: 103,
  denomination: "2 lei",
  issue_date: "1920",
  catalog_number: "220",
});
const NOTE_D = note({
  id: 104,
  denomination: "100 lei",
  issue_date: "1943",
  catalog_number: "500",
});

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
    children,
  };
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

async function openAddDialog() {
  const user = userEvent.setup();
  renderAt(SHOWCASE_ROUTES.showcase(1));
  await screen.findByRole("link", { name: "Kingdom" });
  await user.click(
    await screen.findByRole("button", { name: "Add to this level" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Add to “Summer”",
  });
  await within(dialog).findByText("1 leu · 1917");
  return { user, dialog };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [
      { id: 1, is_default: 1, name: "Kingdom" },
      { id: 2, name: "Inflation" },
    ],
  });
  getShowcases.mockResolvedValue({ showcases: [{ id: 1, name: "My showcase" }] });
  getCategories.mockResolvedValue({ categories: [] });
  getShowcaseTree.mockResolvedValue({
    showcase_id: 1,
    nodes: [categoryNode()],
  });
  getAllNotes.mockImplementation(async (collections) => ({
    notes: collections.flatMap((collection) =>
      (collection.id === 1 ? [NOTE_A, NOTE_B, NOTE_C] : [NOTE_D]).map(
        (entry) => ({
          ...entry,
          collection_id: collection.id,
          collection_name: collection.name,
          collection_order: collection.id,
        }),
      ),
    ),
  }));
  createShowcaseNode.mockResolvedValue({ nodes: [] });
});

describe("the merged add dialog", () => {
  test("lists notes across collections and keeps the catalog family rule", async () => {
    const { user } = await openAddDialog();

    expect(await screen.findByText("1 leu · 1917")).toBeInTheDocument();
    expect(screen.getByText("100 lei · 1943")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter value"), "22");

    expect(screen.getByText("1 leu · 1917")).toBeInTheDocument();
    expect(screen.getByText("1 leu · 1920")).toBeInTheDocument();
    expect(screen.queryByText("2 lei · 1920")).not.toBeInTheDocument();
    expect(screen.queryByText("100 lei · 1943")).not.toBeInTheDocument();
  });

  test("selections accumulate across filters, then Add selected writes at once", async () => {
    createShowcaseNode.mockResolvedValue({
      nodes: [
        { id: 201, node_type: "note", note_id: 101, note: NOTE_A, children: [] },
        { id: 202, node_type: "note", note_id: 102, note: NOTE_B, children: [] },
        { id: 203, node_type: "note", note_id: 103, note: NOTE_C, children: [] },
      ],
    });

    const { user, dialog } = await openAddDialog();
    const filter = screen.getByLabelText("Filter value");

    await user.type(filter, "22");
    await user.click(within(dialog).getByRole("button", { name: "Select all" }));

    await user.clear(filter);
    await user.type(filter, "220");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /2 lei · 1920/ }),
    );

    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (3)" }),
    );

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "notes",
        parent_id: 10,
        note_ids: [101, 102, 103],
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      await screen.findByRole("button", { name: "1 leu, Pick 22, 1917" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 notes")).toBeInTheDocument();
  });

  test("Deselect all removes only the currently filtered picks", async () => {
    createShowcaseNode.mockResolvedValue({
      nodes: [
        { id: 201, node_type: "note", note_id: 101, note: NOTE_A, children: [] },
        { id: 202, node_type: "note", note_id: 102, note: NOTE_B, children: [] },
      ],
    });

    const { user, dialog } = await openAddDialog();
    const filter = screen.getByLabelText("Filter value");

    await user.type(filter, "22");
    await user.click(within(dialog).getByRole("button", { name: "Select all" }));

    await user.clear(filter);
    await user.type(filter, "220");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /2 lei · 1920/ }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Add selected (3)" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Deselect all" }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    );

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "notes",
        parent_id: 10,
        note_ids: [101, 102],
      });
    });
  });

  test("the Placeholder tab creates planned placeholders with no note", async () => {
    createCatalogEntry.mockResolvedValue({
      node: {
        id: 301,
        node_type: "catalog_entry",
        entry: {
          catalog_number: "500",
          denomination: "",
          issue_date: "",
          source: "",
        },
        specimens: [],
        primary_note_id: null,
        children: [],
      },
    });

    const { user, dialog } = await openAddDialog();
    await user.click(within(dialog).getByRole("tab", { name: "Placeholder" }));
    await user.type(within(dialog).getByLabelText("Catalog numbers"), "500");
    await user.click(
      within(dialog).getByRole("button", { name: "Add 1 placeholder" }),
    );

    await waitFor(() => {
      expect(createCatalogEntry).toHaveBeenCalledWith(1, {
        parentId: 10,
        entry: {
          catalog_number: "500",
          denomination: "",
          issue_date: "",
          source: "",
        },
      });
    });
    expect(
      await screen.findByRole("button", { name: /is unseen\. Replace with note/ }),
    ).toBeInTheDocument();
  });
});

describe("a note already in the node", () => {
  test("shows added and its checkbox is disabled", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        categoryNode([
          { id: 40, node_type: "note", note_id: 101, note: NOTE_A, children: [] },
        ]),
      ],
    });

    const { dialog } = await openAddDialog();

    const checkbox = within(dialog).getByRole("checkbox", {
      name: /1 leu · 1917/,
    });
    expect(checkbox).toBeDisabled();
    expect(within(dialog).getByText("added")).toBeInTheDocument();
  });
});
