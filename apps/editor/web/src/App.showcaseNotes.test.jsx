import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The note-picker tests drive the real shell (sidebar + routes) with the web API
// mocked. The other screens are stubbed so the assertions land on the canvas and
// the picker popup, not on their unrelated data loads.
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
  getNotes: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
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
  createShowcaseNode,
  getCategories,
  getCollections,
  getHealth,
  getNotes,
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
    updated_at: "rev",
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

async function openPicker() {
  const user = userEvent.setup();
  renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
  // Categories render expanded, so the `+ notes` tile is on the canvas without
  // opening anything.
  await user.click(await screen.findByRole("button", { name: "Add notes" }));
  return { user, dialog: await screen.findByRole("dialog", { name: "Add notes" }) };
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
  getNotes.mockImplementation(async (collectionId) =>
    collectionId === 1
      ? { notes: [NOTE_A, NOTE_B, NOTE_C] }
      : { notes: [NOTE_D] },
  );
  createShowcaseNode.mockResolvedValue({ nodes: [] });
});

describe("the note picker", () => {
  test("lists notes across collections and keeps the catalog family rule", async () => {
    const { user } = await openPicker();

    // Every collection's notes are listed before a filter is chosen.
    expect(await screen.findByText("1 leu · 1917")).toBeInTheDocument();
    expect(screen.getByText("100 lei · 1943")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Filter value"), "22");

    // 22 and 22a match; 220 does not.
    expect(screen.getByText("1 leu · 1917")).toBeInTheDocument();
    expect(screen.getByText("1 leu · 1920")).toBeInTheDocument();
    expect(screen.queryByText("2 lei · 1920")).not.toBeInTheDocument();
    expect(screen.queryByText("100 lei · 1943")).not.toBeInTheDocument();
  });

  test("the selection accumulates across filters and Add selected keeps it open", async () => {
    createShowcaseNode.mockResolvedValue({
      nodes: [
        { id: 201, node_type: "note", note_id: 101, note: NOTE_A, children: [] },
        { id: 202, node_type: "note", note_id: 102, note: NOTE_B, children: [] },
        { id: 203, node_type: "note", note_id: 103, note: NOTE_C, children: [] },
      ],
    });

    const { user, dialog } = await openPicker();
    const filter = screen.getByLabelText("Filter value");

    await user.type(filter, "22");
    await user.click(within(dialog).getByRole("button", { name: "Select all" }));
    expect(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    ).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "220");
    expect(within(dialog).queryByText("1 leu · 1917")).not.toBeInTheDocument();
    // The earlier picks survive the filter change.
    expect(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("checkbox", { name: /2 lei · 1920/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (3)" }),
    );

    // Staging is local: the popup stays open, the selection resets, and the
    // cards render with no network call.
    expect(createShowcaseNode).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Add selected (0)" })).toBeInTheDocument();
    // The added note cards render on the canvas.
    expect(
      await screen.findByRole("button", { name: "1 leu, 1917" }),
    ).toBeInTheDocument();
    // The header total updates with the tree.
    expect(screen.getByText("3 notes")).toBeInTheDocument();

    // Closing the picker and saving persists the batch.
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "notes",
        parent_id: 10,
        note_ids: [101, 102, 103],
      });
    });
  });

  test("Deselect all removes only the currently filtered picks", async () => {
    createShowcaseNode.mockResolvedValue({ nodes: [] });

    const { user, dialog } = await openPicker();
    const filter = screen.getByLabelText("Filter value");

    await user.type(filter, "22");
    await user.click(within(dialog).getByRole("button", { name: "Select all" }));
    expect(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    ).toBeInTheDocument();

    await user.clear(filter);
    await user.type(filter, "220");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /2 lei · 1920/ }),
    );
    expect(
      within(dialog).getByRole("button", { name: "Add selected (3)" }),
    ).toBeInTheDocument();

    // Deselect all only drops the 220 row; the earlier picks survive.
    await user.click(within(dialog).getByRole("button", { name: "Deselect all" }));
    expect(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Add selected (2)" }),
    );

    // Staged locally; Save persists the batch.
    expect(createShowcaseNode).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "notes",
        parent_id: 10,
        note_ids: [101, 102],
      });
    });
  });

  test("Add & close stages the notes and Save persists them", async () => {
    createShowcaseNode.mockResolvedValue({
      nodes: [{ id: 204, node_type: "note", note_id: 104, note: NOTE_D, children: [] }],
    });

    const { user } = await openPicker();

    await user.type(screen.getByLabelText("Filter value"), "500");
    await user.click(screen.getByRole("button", { name: "Select all" }));
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    expect(createShowcaseNode).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "notes",
        parent_id: 10,
        note_ids: [104],
      });
    });
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

    const { dialog } = await openPicker();

    const checkbox = within(dialog).getByRole("checkbox", { name: /1 leu · 1917/ });
    expect(checkbox).toBeDisabled();
    expect(within(dialog).getByText("added")).toBeInTheDocument();
  });
});
