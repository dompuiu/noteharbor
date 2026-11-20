import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// A showcase is one editable canvas now: dragging a cell reorders it and
// persists immediately. These tests observe the API call and the on-screen
// order a drag leaves behind.
vi.mock("./lib/api.js", () => ({
  createCatalogEntry: vi.fn(),
  createCategory: vi.fn(),
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  createShowcaseNode: vi.fn(),
  deleteCategory: vi.fn(),
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
  replaceCatalogEntryWithNote: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
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

function cellFor(label) {
  return screen
    .getByRole("button", { name: label })
    .closest(".showcase-reorder-cell");
}

function canvasOrder() {
  return (
    within(document.querySelector(".showcase-screen"))
      .getAllByRole("button")
      .map((card) => card.getAttribute("aria-label"))
      .filter((label) =>
        ["Open grouping Sub", "2020 · 1", "1990 · 5"].includes(label),
      )
  );
}

async function openSummer() {
  await screen.findByRole("button", { name: "Open grouping Sub" });
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
  test("every card sits in a draggable cell with an actions menu", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSummer();

    const cells = document.querySelectorAll(
      ".showcase-screen .showcase-reorder-cell",
    );
    expect(cells).toHaveLength(3);
    cells.forEach((cell) => expect(cell).toHaveAttribute("draggable", "true"));
    expect(
      screen.getByRole("button", { name: "Actions for Sub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for 1 2020" }),
    ).toBeInTheDocument();
  });

  test("tabbing through the canvas never lands on the drag grip", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSummer();

    const start = screen.getByRole("button", { name: "Actions for Sub" });
    act(() => start.focus());

    const canvas = document.querySelector(".showcase-screen");

    for (let step = 0; step < 20; step += 1) {
      await user.tab();

      if (!canvas?.contains(document.activeElement)) {
        break;
      }

      expect(document.activeElement?.className ?? "").not.toContain(
        "showcase-reorder-handle",
      );
    }
  });

  test("dragging a grouping past its notes persists the order immediately", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSummer();

    const source = cellFor("Open grouping Sub");
    const target = cellFor("1990 · 5");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      source.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      target.dispatchEvent(
        dragEvent("dragover", { clientY: 0, clientX: 5, dataTransfer }),
      );
    });
    await act(async () => {
      target.dispatchEvent(
        dragEvent("drop", { clientY: 0, clientX: 5, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(reorderNodes).toHaveBeenCalledWith(1, 10, [11, 12, 20]);
    });
    expect(canvasOrder()).toEqual(["2020 · 1", "1990 · 5", "Open grouping Sub"]);
  });

  test("a drag that lands a card back where it started persists nothing", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSummer();

    const source = cellFor("Open grouping Sub");
    const target = cellFor("2020 · 1");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      source.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      target.dispatchEvent(
        dragEvent("dragover", { clientY: 0, clientX: -5, dataTransfer }),
      );
    });
    await act(async () => {
      target.dispatchEvent(
        dragEvent("drop", { clientY: 0, clientX: -5, dataTransfer }),
      );
    });

    expect(reorderNodes).not.toHaveBeenCalled();
    expect(canvasOrder()).toEqual(["Open grouping Sub", "2020 · 1", "1990 · 5"]);
  });
});
