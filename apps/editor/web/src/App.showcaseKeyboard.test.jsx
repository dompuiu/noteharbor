import { MemoryRouter, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The keyboard tests drive the real shell (sidebar + routes) with the web API
// mocked. Behavior is observed through focus and the route, never through the
// screen's internals, so the table's model can be refactored freely.
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
  deleteNode,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  reorderNodes,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { PORTFOLIO_ROUTES } from "./lib/routes.js";

const FRONT = (id) => ({
  type: "front",
  variant: "thumbnail",
  localPath: `/api/images/notes/${id}/front.jpg`,
});

const BACK = (id) => ({
  type: "back",
  variant: "thumbnail",
  localPath: `/api/images/notes/${id}/back.jpg`,
});

function note(id, { denomination, issue_date, images }) {
  return {
    id,
    denomination,
    issue_date,
    updated_at: `rev-${id}`,
    images: images ?? [FRONT(id)],
  };
}

function noteNode(id, theNote, position = 1) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: null,
    note_id: theNote.id,
    cover_note_id: null,
    position,
    note: theNote,
    cover_note: null,
    children: [],
  };
}

function groupingNode({ id, name, children = [], position = 1 }) {
  return {
    id,
    node_type: "grouping",
    name,
    category_id: null,
    parent_node_id: 10,
    note_id: null,
    cover_note_id: null,
    position,
    note: null,
    cover_note: null,
    children,
  };
}

function categoryNode({ id, name, children = [], position = 1 }) {
  return {
    id,
    node_type: "category",
    name,
    category_id: id,
    parent_node_id: null,
    note_id: null,
    cover_note_id: null,
    position,
    note: null,
    cover_note: null,
    children,
  };
}

const NOTE_WITH_BACK = note(100, {
  denomination: "1 leu",
  issue_date: "1917",
  images: [FRONT(100), BACK(100)],
});

function summerTree() {
  return [
    categoryNode({
      id: 10,
      name: "Summer",
      position: 1,
      children: [
        noteNode(400, NOTE_WITH_BACK, 1),
        groupingNode({
          id: 20,
          name: "Sub",
          position: 2,
          children: [noteNode(410, note(300, { denomination: "10 lei", issue_date: "1930" }), 1)],
        }),
      ],
    }),
    categoryNode({ id: 11, name: "Vienna", position: 2, children: [] }),
  ];
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
  return <span data-testid="search">{location.search}</span>;
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
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: summerTree() });
  deleteNode.mockResolvedValue({ success: true });
  reorderNodes.mockResolvedValue({ nodes: [] });
});

async function summerCard() {
  return screen.findByRole("button", { name: "Open category Summer" });
}

describe("moving card focus", () => {
  test("the arrow keys walk the cards in grid order", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    const summer = await summerCard();
    const vienna = screen.getByRole("button", { name: "Open category Vienna" });

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(summer).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(vienna).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(summer).toHaveFocus();
  });

  test("h/j/k/l move the focus like the arrow keys", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    const summer = await summerCard();
    const vienna = screen.getByRole("button", { name: "Open category Vienna" });

    fireEvent.keyDown(document.body, { key: "j" });
    expect(summer).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "l" });
    expect(vienna).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "k" });
    expect(summer).toHaveFocus();
  });

  test("Home and End focus the first and last card", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    const summer = await summerCard();
    const vienna = screen.getByRole("button", { name: "Open category Vienna" });

    fireEvent.keyDown(document.body, { key: "End" });
    expect(vienna).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Home" });
    expect(summer).toHaveFocus();
  });

  test("PageDown and PageUp move by a screen of rows", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: manyCategories(12),
    });
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    const cards = await screen.findAllByRole("button", {
      name: /^Open category /,
    });
    stubGridRects(cards, 3, { height: 100 });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 250,
    });

    act(() => cards[0].focus());

    fireEvent.keyDown(document.body, { key: "PageDown" });
    expect(cards[6]).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "PageUp" });
    expect(cards[0]).toHaveFocus();
  });
});

// Twelve categories in a single level, for the page-sized movement test.
function manyCategories(count) {
  return Array.from({ length: count }, (_, index) =>
    categoryNode({
      id: 100 + index,
      name: `Category ${index + 1}`,
      position: index + 1,
    }),
  );
}

// Assign every card a rect on a `columns`-wide grid so page movement can be
// computed the way it is in a browser. jsdom reports all-zero rects otherwise.
function stubGridRects(cards, columns, { width = 200, height = 100, gap = 0 }) {
  const pitch = height + gap;

  cards.forEach((card, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    card.getBoundingClientRect = () => ({
      top: row * pitch,
      left: column * (width + gap),
      width,
      height,
      right: column * (width + gap) + width,
      bottom: row * pitch + height,
      x: column * (width + gap),
      y: row * pitch,
    });
  });
}

