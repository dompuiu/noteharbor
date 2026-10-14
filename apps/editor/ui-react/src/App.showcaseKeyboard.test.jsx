import { MemoryRouter, useLocation } from "react-router-dom";
import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// These tests render the full shell and open the note picker, so their async
// queries can exceed Testing Library's 1000ms default under full-suite load.
// Scoped to this file (each test file gets a fresh environment).
configure({ asyncUtilTimeout: 5000 });

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
  getNotes: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
  reorderNodes: vi.fn(),
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
  deleteNode,
  getCategories,
  getCollections,
  getHealth,
  getNotes,
  getShowcases,
  getShowcaseTree,
  reorderNodes,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

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
  getNotes.mockResolvedValue({ notes: [] });
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: summerTree() });
  deleteNode.mockResolvedValue({ success: true });
  reorderNodes.mockResolvedValue({ nodes: [] });
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

  test("Home and End focus the first and last card", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const { note, sub } = await firstContentCards();

    fireEvent.keyDown(document.body, { key: "End" });
    expect(sub).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Home" });
    expect(note).toHaveFocus();
  });

  test("PageDown and PageUp move by a screen of rows", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [categoryNode({ id: 10, name: "Summer", children: manyNotes(12) })],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const cards = await screen.findAllByRole("button", {
      name: /^1 leu, 1917 #/,
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

function search() {
  return screen.getByTestId("search").textContent;
}

describe("opening the focused card", () => {
  test("Enter opens a focused grouping card in view mode", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });

    act(() => sub.focus());
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(search()).toBe("?node=20"));
  });

  test("Enter opens an edit-mode grouping through its single click", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();

    act(() => sub.focus());
    await userEvent.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
  });

  test("Enter and Space open the preview on a view-mode note card", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const card = await screen.findByRole("button", { name: "1 leu, 1917" });
    // Focus alone never flips; activation opens the showcase-wide preview at
    // the visible face instead of drilling, so the drill param stays empty.
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

  test("focus returns to the card you drilled from after going up", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());
    await userEvent.keyboard("{Enter}");

    expect(
      await screen.findByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open grouping Sub" }),
      ).toHaveFocus(),
    );
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

describe("editing from the keyboard", () => {
  async function focusSub() {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    // Let the name draft converge from the list before blurring it: the
    // field is autofocused, so focusing away earlier would commit stale text.
    await waitFor(() =>
      expect(screen.getByLabelText("Showcase name")).toHaveValue("My showcase"),
    );
    act(() => sub.focus());
    return sub;
  }

  test("a opens the note picker for the focused card", async () => {
    await focusSub();

    fireEvent.keyDown(document.body, { key: "a" });

    const dialog = await screen.findByRole("dialog", { name: "Add notes" });
    expect(dialog).toHaveTextContent("Sub");
  });

  test("g reveals the create-a-grouping field", async () => {
    await focusSub();

    fireEvent.keyDown(document.body, { key: "g" });

    expect(await screen.findByLabelText("Grouping name")).toBeInTheDocument();
  });

  test("e starts renaming the focused card", async () => {
    await focusSub();

    fireEvent.keyDown(document.body, { key: "e" });

    expect(await screen.findByLabelText("New name for Sub")).toBeInTheDocument();
  });

  test("d stages the removal of the focused card and Save deletes it", async () => {
    await focusSub();

    fireEvent.keyDown(document.body, { key: "d" });

    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
    expect(deleteNode).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(20));
  });

  test("the single-key actions do nothing in view mode", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());

    for (const key of ["a", "g", "e", "d"]) {
      fireEvent.keyDown(document.body, { key });
    }

    expect(deleteNode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Grouping name")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Add notes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
  });

  test("e with no card focused enters edit mode on the same level", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcase(1)}?node=20`);

    await screen.findByRole("button", { name: "Open grouping Deep" });
    expect(
      screen.queryByLabelText("Showcase name"),
    ).not.toBeInTheDocument();

    if (document.activeElement instanceof HTMLElement) {
      act(() => document.activeElement.blur());
    }

    fireEvent.keyDown(document.body, { key: "e" });

    expect(await screen.findByLabelText("Showcase name")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
    expect(search()).toBe("?node=20");
  });

  test("e with a focused card stays in view mode", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());

    fireEvent.keyDown(document.body, { key: "e" });

    expect(
      screen.queryByLabelText("Showcase name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
  });
});

describe("edit-mode header focus", () => {
  function firstCard() {
    const card = document.querySelector(".showcase-screen .showcase-card");
    expect(card).not.toBeNull();
    return card;
  }

  test("entering edit mode focuses the showcase name input", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const nameField = await screen.findByLabelText("Showcase name");
    await waitFor(() => expect(nameField).toHaveFocus());
  });

  test("entering edit mode from view lands focus in the showcase name input", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    if (document.activeElement instanceof HTMLElement) {
      act(() => document.activeElement.blur());
    }

    fireEvent.keyDown(document.body, { key: "e" });

    const nameField = await screen.findByLabelText("Showcase name");
    await waitFor(() => expect(nameField).toHaveFocus());
  });

  test("Down arrow in the showcase name moves focus to the first card", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const nameField = await screen.findByLabelText("Showcase name");
    await screen.findByRole("button", { name: "1 leu, 1917" });

    act(() => nameField.focus());
    fireEvent.keyDown(nameField, { key: "ArrowDown" });

    expect(screen.getByRole("heading", { name: "Summer" })).toHaveFocus();
  });

  test("Down arrow in the photo size moves focus to the first card without changing the size", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const small = await screen.findByRole("radio", { name: "Small" });
    await screen.findByRole("button", { name: "1 leu, 1917" });
    expect(small).toBeChecked();

    act(() => small.focus());
    fireEvent.keyDown(small, { key: "ArrowDown" });

    expect(screen.getByRole("heading", { name: "Summer" })).toHaveFocus();
    expect(small).toBeChecked();
  });

  test("Up arrow in the photo size keeps focus without changing the size", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const small = await screen.findByRole("radio", { name: "Small" });
    await screen.findByRole("button", { name: "1 leu, 1917" });
    expect(small).toBeChecked();

    act(() => small.focus());
    fireEvent.keyDown(small, { key: "ArrowUp" });

    expect(small).toHaveFocus();
    expect(small).toBeChecked();
  });

  test("blurring the untouched name field leaves the draft clean", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const nameField = await screen.findByLabelText("Showcase name");
    await waitFor(() => expect(nameField).toHaveValue("My showcase"));

    const card = await screen.findByRole("button", { name: "1 leu, 1917" });
    act(() => card.focus());

    expect(nameField).toHaveValue("My showcase");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

// Twelve notes in one category, for the page-sized movement test.
function manyNotes(count) {
  return Array.from({ length: count }, (_, index) =>
    noteNode(
      500 + index,
      note(900 + index, {
        denomination: "1 leu",
        issue_date: `1917 #${index + 1}`,
      }),
      index + 1,
    ),
  );
}

describe("guards", () => {
  test("the shortcuts stay out of a text field", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    const nameField = await screen.findByLabelText("Showcase name");

    act(() => nameField.focus());
    await userEvent.type(nameField, "gd");

    expect(screen.queryByLabelText("Grouping name")).not.toBeInTheDocument();
    expect(deleteNode).not.toHaveBeenCalled();
  });

  test("an open dialog disables the card shortcuts", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());
    fireEvent.keyDown(document.body, { key: "a" });
    await screen.findByRole("dialog", { name: "Add notes" });

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "?" });

    expect(document.activeElement.closest(".showcase-card")).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
  });

  test("an open confirmation dialog also disables the card shortcuts", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    await userEvent.click(
      screen.getByRole("button", { name: "Delete showcase" }),
    );
    await screen.findByRole("dialog");

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.body, { key: "?" });

    expect(document.activeElement.closest(".showcase-card")).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
    ).not.toBeInTheDocument();
  });

  test("a Meta/Ctrl chord is left to the browser", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());

    fireEvent.keyDown(document.body, { key: "d", ctrlKey: true });
    fireEvent.keyDown(sub, { key: "e", metaKey: true });

    expect(deleteNode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New name for Sub")).not.toBeInTheDocument();
  });

  test("the sidebar keeps its own keys", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    const sidebar = document.getElementById("app-sidebar");
    const link = sidebar.querySelector("a");

    act(() => link.focus());
    fireEvent.keyDown(link, { key: "ArrowDown" });

    expect(document.activeElement.closest(".showcase-card")).toBeNull();
  });
});

describe("the note picker", () => {
  async function openPickerOnSub() {
    getNotes.mockResolvedValue({ notes: [NOTE_WITH_BACK] });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    // Let the name draft converge before blurring it: the field is
    // autofocused, so focusing a card earlier can lose card focus on the
    // converging rerender and the "a" shortcut never opens the picker
    // (the checkbox query then pends until the test times out).
    await waitFor(() =>
      expect(screen.getByLabelText("Showcase name")).toHaveValue("My showcase"),
    );
    const sub = screen.getByRole("button", { name: "Open grouping Sub" });
    act(() => sub.focus());
    fireEvent.keyDown(document.body, { key: "a" });

    return screen.findByRole("dialog", { name: "Add notes" });
  }

  test("/ focuses the picker's filter field from another control", async () => {
    const dialog = await openPickerOnSub();

    const checkbox = await within(dialog).findByRole("checkbox");
    act(() => checkbox.focus());

    fireEvent.keyDown(checkbox, { key: "/" });

    expect(screen.getByLabelText("Filter value")).toHaveFocus();
  });

  test("a slash typed in the filter field stays a slash", async () => {
    await openPickerOnSub();

    const filter = await screen.findByLabelText("Filter value");
    act(() => filter.focus());
    await userEvent.keyboard("/");

    expect(filter).toHaveValue("/");
  });
});

describe("shortcut help", () => {
  test("? opens the shortcut help with the Showcase keys", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    fireEvent.keyDown(document.body, { key: "?" });

    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    expect(dialog).toHaveTextContent("Move focus between the cards");
    expect(dialog).toHaveTextContent("Open the focused card");
  });

  test("the cards ignore the shortcuts while the help is open", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const note = await screen.findByRole("button", { name: "1 leu, 1917" });
    const sub = await screen.findByRole("button", { name: "Open grouping Sub" });

    act(() => note.focus());
    fireEvent.keyDown(document.body, { key: "?" });
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(note).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Keyboard shortcuts" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(sub).toHaveFocus();
  });
});

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


describe("edit-mode add tiles in the arrow sequence", () => {
  test("the arrows walk from the cards through Add notes and Add grouping", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const summer = await screen.findByRole("heading", { name: "Summer" });
    const note = screen.getByRole("button", { name: "1 leu, 1917" });
    const sub = screen.getByRole("button", { name: "Open grouping Sub" });
    const addNotes = screen.getAllByRole("button", { name: "Add notes" })[0];
    const addGrouping = screen.getAllByRole("button", {
      name: "Add grouping",
    })[0];

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(summer).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(note).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(sub).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(addNotes).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(addGrouping).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(addNotes).toHaveFocus();
  });

  test("Home and End include the tiles at the ends of the sequence", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("button", { name: "1 leu, 1917" });

    fireEvent.keyDown(document.body, { key: "End" });
    expect(
      screen.getByRole("button", { name: "Create a category" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Home" });
    expect(screen.getByRole("heading", { name: "Summer" })).toHaveFocus();
  });

  test("Escape on a focused category header only clears the focus", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const summer = await screen.findByRole("heading", { name: "Summer" });
    act(() => summer.focus());
    expect(summer).toHaveFocus();

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(summer).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  test("Escape with nothing focused in edit mode at the root exits to view", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    await screen.findByRole("heading", { name: "Summer" });
    await waitFor(() =>
      expect(screen.getByLabelText("Showcase name")).toHaveValue(
        "My showcase",
      ),
    );
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();

    if (document.activeElement instanceof HTMLElement) {
      act(() => document.activeElement.blur());
    }

    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByLabelText("Showcase name"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
    expect(search()).toBe("");
  });

  test("the arrows from a reorder handle move relative to its own card", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const summer = await screen.findByRole("heading", { name: "Summer" });
    const note = screen.getByRole("button", { name: "1 leu, 1917" });
    const sub = screen.getByRole("button", { name: "Open grouping Sub" });
    const reorderNote = screen.getByRole("button", {
      name: "Reorder 1 leu 1917",
    });
    const reorderSub = screen.getByRole("button", { name: "Reorder Sub" });

    act(() => reorderNote.focus());
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(sub).toHaveFocus();

    act(() => reorderSub.focus());
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(screen.getAllByRole("button", { name: "Add notes" })[0]).toHaveFocus();

    act(() => reorderNote.focus());
    fireEvent.keyDown(document.body, { key: "ArrowUp" });
    expect(summer).toHaveFocus();

    // The reported flow: category action -> note -> next item (never the
    // first category again).
    const renameSummer = screen.getByRole("button", {
      name: "Rename Summer",
    });
    act(() => renameSummer.focus());
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(note).toHaveFocus();
    fireEvent.keyDown(document.body, { key: "ArrowDown" });
    expect(sub).toHaveFocus();
  });
});
