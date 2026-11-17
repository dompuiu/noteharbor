import { MemoryRouter, useLocation } from "react-router-dom";
import {
  act,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 });

// The keyboard tests drive the real shell (sidebar + routes) with the web API
// mocked. A showcase is one editable view now, so the shortcuts only move focus,
// open cards, and open the same merged Add dialog a click would.
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
  getAllNotes: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
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
  getAllNotes,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

const FRONT = (id) => ({
  type: "front",
  variant: "thumbnail",
  localPath: `/api/images/notes/${id}/front.jpg`,
});

function note(id, { denomination, issue_date }) {
  return {
    id,
    denomination,
    issue_date,
    updated_at: `rev-${id}`,
    images: [FRONT(id)],
  };
}

function noteNode(id, theNote, position = 1) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: 10,
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
  images: [FRONT(100), { ...FRONT(100), type: "back", localPath: "/api/images/notes/100/back.jpg" }],
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
          children: [
            noteNode(410, note(300, { denomination: "10 lei", issue_date: "1930" }), 1),
            groupingNode({
              id: 30,
              name: "Deep",
              position: 2,
              children: [
                noteNode(411, note(301, { denomination: "20 lei", issue_date: "1940" }), 1),
              ],
            }),
          ],
        }),
      ],
    }),
    categoryNode({ id: 11, name: "Vienna", position: 2, children: [] }),
  ];
}

function manyNotes(count) {
  return Array.from({ length: count }, (_, index) =>
    noteNode(
      500 + index,
      note(600 + index, {
        denomination: "1 leu",
        issue_date: `1917 #${index + 1}`,
      }),
      index + 1,
    ),
  );
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

function search() {
  return screen.getByTestId("search").textContent;
}

function stubGridRects(cards, columns, { height = 100 } = {}) {
  cards.forEach((card, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    card.getBoundingClientRect = () => ({
      top: row * height,
      bottom: row * height + height,
      left: column * 200,
      right: column * 200 + 200,
      width: 200,
      height,
      x: column * 200,
      y: row * height,
      toJSON: () => {},
    });
  });
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
  getAllNotes.mockResolvedValue({ notes: [] });
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: summerTree() });
});

async function firstContentCards() {
  const note = await screen.findByRole("button", { name: "1 leu, 1917" });
  const sub = screen.getByRole("button", { name: "Open grouping Sub" });
  return { note, sub };
}

describe("moving card focus", () => {
  test("the arrow keys walk the cards in grid order", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const { note, sub } = await firstContentCards();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(note).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(sub).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(note).toHaveFocus();
  });

  test("h/j/k/l move the focus like the arrow keys", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const { note, sub } = await firstContentCards();

    fireEvent.keyDown(document.body, { key: "j" });
    expect(note).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "l" });
    expect(sub).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "k" });
    expect(note).toHaveFocus();
  });

  test("Home and End focus the first card and the last add tile", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const { note } = await firstContentCards();

    fireEvent.keyDown(document.body, { key: "End" });
    expect(screen.getByRole("button", { name: "New category" })).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Home" });
    expect(note).toHaveFocus();
  });

  test("PageDown and PageUp move by a screen of rows", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [categoryNode({ id: 10, name: "Summer", children: manyNotes(12) })],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findAllByRole("button", { name: /^1 leu, 1917 #/ });
    const cards = Array.from(
      document.querySelectorAll(
        ".showcase-screen .showcase-card, .showcase-screen .showcase-ghost-add",
      ),
    );
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

describe("opening the focused card", () => {
  test("Enter opens a focused grouping card", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });

    act(() => sub.focus());
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(search()).toBe("?node=20"));
  });

  test("Enter and Space open the preview on a note card", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const card = await screen.findByRole("button", { name: "1 leu, 1917" });
    act(() => card.focus());
    expect(card).toHaveAttribute("aria-pressed", "false");

    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(search()).toBe("?preview=400%3Afront"));
    expect(
      await screen.findByRole("button", { name: "Close preview" }),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "Close preview" }),
    );
    await waitFor(() => expect(search()).toBe(""));

    act(() => card.focus());
    await userEvent.keyboard(" ");
    await waitFor(() => expect(search()).toBe("?preview=400%3Afront"));
    act(() => card.blur());
    expect(card).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Escape and focus restoration", () => {
  test("Escape clears the card focus, then goes up a level", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await userEvent.click(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    );
    const deep = await screen.findByRole("button", {
      name: "Open grouping Deep",
    });
    act(() => deep.focus());

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(deep).not.toHaveFocus();
    expect(search()).toBe("?node=20");

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(search()).toBe(""));
    expect(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    ).toHaveFocus();
  });

  test("the breadcrumb restores focus to the card you left", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await userEvent.click(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    );
    await screen.findByRole("button", { name: "10 lei, 1930" });

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("My showcase"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open grouping Sub" }),
      ).toHaveFocus(),
    );
  });
});

describe("keyboard add and menus", () => {
  test("a opens the merged add dialog after the focused card", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });

    act(() => sub.focus());
    fireEvent.keyDown(document.body, { key: "a" });

    const dialog = await screen.findByRole("dialog", {
      name: "Add to “Summer”",
    });
    expect(dialog).toHaveTextContent("after the chosen item");
  });

  test("an open dialog disables the card shortcuts", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const { note } = await firstContentCards();
    act(() => note.focus());

    const summer = screen.getByRole("region", { name: "Category Summer" });
    await userEvent.click(
      within(summer).getByRole("button", { name: "Add a note or placeholder" }),
    );
    await screen.findByRole("dialog", { name: "Add to “Summer”" });

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    // Focus stayed in the dialog; the grid did not move.
    expect(note).not.toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("/ focuses the picker's filter field inside the add dialog", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    const summer = screen.getByRole("region", { name: "Category Summer" });
    await userEvent.click(
      within(summer).getByRole("button", { name: "Add a note or placeholder" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Add to “Summer”" });
    const done = within(dialog).getByRole("button", { name: "Close add dialog" });
    act(() => done.focus());

    fireEvent.keyDown(done, { key: "/" });

    expect(within(dialog).getByLabelText("Filter value")).toHaveFocus();
  });

  test("the item menu opens by keyboard and returns focus to its trigger", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const trigger = await screen.findByRole("button", {
      name: "Actions for Sub",
    });

    act(() => trigger.focus());
    await userEvent.keyboard("{Enter}");
    const menu = await screen.findByRole("menu", { name: "Actions for Sub" });
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(0);

    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});

describe("header focus", () => {
  test("Down arrow in the showcase name moves focus to the first card", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const first = await screen.findByRole("button", { name: "1 leu, 1917" });

    await user.click(
      screen.getByRole("button", { name: "Rename showcase: My showcase" }),
    );
    const field = await screen.findByLabelText("Showcase name");

    act(() => field.focus());
    fireEvent.keyDown(field, { key: "ArrowDown" });

    expect(first).toHaveFocus();
  });

  test("an unchanged name cancels without renaming the showcase", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await user.click(
      await screen.findByRole("button", {
        name: "Rename showcase: My showcase",
      }),
    );
    const field = await screen.findByLabelText("Showcase name");
    expect(field).toHaveValue("My showcase");

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", {
        name: "Rename showcase: My showcase",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Showcase name")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My showcase" })).toBeInTheDocument();
  });
});
