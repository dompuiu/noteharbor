import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The reorder tests render the real shell (sidebar + routes) in edit mode with
// the web API mocked. A drag on a cell is observed through the API call it
// makes and the on-screen order it leaves behind.
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
  reorderNodes: vi.fn(),
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
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  reorderNodes,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

const NOTE_A = {
  id: 100,
  denomination: "1",
  issue_date: "2020",
  updated_at: "2024-05-01",
  images: [
    {
      type: "front",
      variant: "thumbnail",
      localPath: "/api/images/notes/100/front-thumbnail.jpg",
    },
  ],
};

const NOTE_B = {
  id: 200,
  denomination: "5",
  issue_date: "1990",
  updated_at: "2024-06-01",
  images: [
    {
      type: "front",
      variant: "thumbnail",
      localPath: "/api/images/notes/200/front-thumbnail.jpg",
    },
  ],
};

function noteNode(id, note) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: 10,
    note_id: note.id,
    cover_note_id: null,
    position: 1,
    note,
    cover_note: null,
    children: [],
  };
}

function groupingNode({ id, name, children = [] }) {
  return {
    id,
    node_type: "grouping",
    name,
    category_id: null,
    parent_node_id: 10,
    note_id: null,
    cover_note_id: null,
    position: 1,
    note: null,
    cover_note: null,
    children,
  };
}

// One category placement "Summer" whose children interleave a Grouping and two
// notes: [Sub, note A, note B].
function summerTree() {
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
    children: [
      groupingNode({ id: 20, name: "Sub" }),
      noteNode(11, NOTE_A),
      noteNode(12, NOTE_B),
    ],
  };
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

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

function dragEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function makeDataTransfer() {
  return {
    effectAllowed: "",
    setData: vi.fn(),
    setDragImage: vi.fn(),
    getData: vi.fn(() => ""),
  };
}

function reorderLabels() {
  return screen
    .getAllByRole("button", { name: /^Reorder / })
    .map((handle) => handle.getAttribute("aria-label"));
}

async function openSummer() {
  await screen.findByRole("button", { name: "Reorder Sub" });
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
  getCategories.mockResolvedValue({ categories: [] });
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [summerTree()] });
  reorderNodes.mockResolvedValue({ nodes: [] });
});

describe("showcase child reordering", () => {
  test("edit mode shows a drag handle on each note and grouping", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await openSummer();

    expect(reorderLabels()).toEqual([
      "Reorder Sub",
      "Reorder 1 2020",
      "Reorder 5 1990",
    ]);
  });

  test("dragging a grouping past its notes stages the order and saves it on Save", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await openSummer();

    const source = screen.getByRole("button", { name: "Reorder Sub" });
    const targetHandle = screen.getByRole("button", { name: "Reorder 5 1990" });
    const targetCell = targetHandle.closest(".showcase-reorder-cell");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      source.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      targetCell.dispatchEvent(
        dragEvent("dragover", { clientY: 0, clientX: 0, dataTransfer }),
      );
    });
    await act(async () => {
      targetCell.dispatchEvent(
        dragEvent("drop", { clientY: 0, clientX: 0, dataTransfer }),
      );
    });

    // Staged locally: the order changes with no network call.
    expect(reorderLabels()).toEqual([
      "Reorder 1 2020",
      "Reorder 5 1990",
      "Reorder Sub",
    ]);
    expect(reorderNodes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(reorderNodes).toHaveBeenCalledWith(1, 10, [11, 12, 20]);
    });
  });

  test("a drag that lands a card back where it started persists nothing", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await openSummer();

    const source = screen.getByRole("button", { name: "Reorder Sub" });
    const targetHandle = screen.getByRole("button", { name: "Reorder 1 2020" });
    const targetCell = targetHandle.closest(".showcase-reorder-cell");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      source.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      // A negative clientY is above the (all-zero) rect midpoint, so the
      // placement is "before" — Sub stays immediately ahead of note A.
      targetCell.dispatchEvent(
        dragEvent("dragover", { clientY: -5, clientX: 0, dataTransfer }),
      );
    });
    await act(async () => {
      targetCell.dispatchEvent(
        dragEvent("drop", { clientY: -5, clientX: 0, dataTransfer }),
      );
    });

    expect(reorderNodes).not.toHaveBeenCalled();
    expect(reorderLabels()).toEqual([
      "Reorder Sub",
      "Reorder 1 2020",
      "Reorder 5 1990",
    ]);
  });
});
