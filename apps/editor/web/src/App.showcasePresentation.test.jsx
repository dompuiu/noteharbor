import { BrowserRouter, MemoryRouter, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The read-only presentation tests drive the real shell (sidebar + routes) with
// the web API mocked. The other screens are stubbed so the assertions land on
// the browse canvas, not on their unrelated data loads.
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
  renameCategory: vi.fn(),
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
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { PORTFOLIO_ROUTES } from "./lib/routes.js";

function shell() {
  return (
    <CollectionsProvider>
      <ShowcasesProvider>
        <ShellContent />
      </ShowcasesProvider>
    </CollectionsProvider>
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <span data-testid="pathname">{location.pathname}</span>
      <span data-testid="search">{location.search}</span>
    </>
  );
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      {shell()}
    </MemoryRouter>,
  );
}

function currentSearch() {
  return screen.getByTestId("search").textContent;
}

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

const NOTE_FRONT_ONLY = note(200, {
  denomination: "5 lei",
  issue_date: "1920",
});

const SUB_NOTE = note(300, { denomination: "10 lei", issue_date: "1930" });

function presentationTree() {
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
          children: [noteNode(410, SUB_NOTE, 1)],
        }),
      ],
    }),
    categoryNode({
      id: 11,
      name: "Vienna",
      position: 2,
      children: [],
    }),
  ];
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
  getShowcaseTree.mockResolvedValue({
    showcase_id: 1,
    nodes: presentationTree(),
  });
});

async function openSummer() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Open category Summer" }),
  );
}

describe("browsing a showcase read-only", () => {
  test("lands on the Categories as name-only cards", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open category Vienna" }),
    ).toBeInTheDocument();
    // Nothing expands inline: a child grouping is hidden until its parent opens.
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
  });

  test("opening a Category shows its direct children in manual order", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    const noteCard = screen.getByRole("button", { name: "1 leu, 1917" });
    const groupingCard = screen.getByRole("button", {
      name: "Open grouping Sub",
    });

    const grid = screen.getByTestId("showcase-grid");
    const cards = within(grid).getAllByRole("button");
    expect(cards.indexOf(noteCard)).toBeLessThan(cards.indexOf(groupingCard));
  });

  test("opening a Grouping shows its direct children", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    await userEvent.click(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    );

    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("an empty showcase shows its message", async () => {
    getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [] });
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
  });

  test("a node with no items shows its message", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    await userEvent.click(
      await screen.findByRole("button", { name: "Open category Vienna" }),
    );

    expect(await screen.findByText("No notes here yet.")).toBeInTheDocument();
  });
});

describe("view-mode URL sync", () => {
  test("the root has no node parameter and drilling adds one", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open category Summer" });

    expect(currentSearch()).toBe("");

    await openSummer();
    expect(currentSearch()).toBe("?node=10");
  });

  test("Up and the breadcrumb each move up a level", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();
    await userEvent.click(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    );
    expect(currentSearch()).toBe("?node=20");

    await userEvent.click(screen.getByRole("button", { name: "Up" }));
    expect(currentSearch()).toBe("?node=10");

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("My showcase"));
    expect(currentSearch()).toBe("");
  });

  test("a deep link opens the node named in the URL", async () => {
    renderAt(`${PORTFOLIO_ROUTES.showcase(1)}?node=20`);

    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("each drill is a history entry so the browser Back button works", async () => {
    window.history.replaceState(null, "", PORTFOLIO_ROUTES.showcase(1));
    render(<BrowserRouter>{shell()}</BrowserRouter>);
    await screen.findByRole("button", { name: "Open category Summer" });

    await userEvent.click(
      screen.getByRole("button", { name: "Open category Summer" }),
    );
    await waitFor(() => {
      expect(window.location.search).toBe("?node=10");
    });

    await act(async () => {
      window.history.back();
    });

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
  });

  test("edit mode keeps the drill state out of the URL", async () => {
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));
    await openSummer();

    expect(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
    expect(currentSearch()).toBe("");
  });
});

describe("entering a node", () => {
  test("announces the node name and item count in a polite live region", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");

    await openSummer();

    await waitFor(() => {
      expect(status).toHaveTextContent("Summer, 2 items");
    });
  });
});

describe("the note card in view mode", () => {
  async function openWithNote() {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    return screen.getByRole("button", { name: "1 leu, 1917" });
  }

  test("hovering swaps to the back and leaving returns to the front", async () => {
    const card = await openWithNote();

    await userEvent.hover(card);
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/back.jpg?v=rev-100",
    );

    await userEvent.unhover(card);
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
  });

  test("focusing swaps to the back and blurring returns to the front", async () => {
    const card = await openWithNote();

    act(() => card.focus());
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/back.jpg?v=rev-100",
    );

    act(() => card.blur());
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
  });

  test("a tap swaps to the back and never navigates", async () => {
    const card = await openWithNote();
    const searchBefore = currentSearch();

    fireEvent.click(card);

    expect(card).toHaveAttribute("aria-pressed", "true");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/back.jpg?v=rev-100",
    );
    expect(currentSearch()).toBe(searchBefore);

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("a card is focusable and reports its label and pressed state", async () => {
    const card = await openWithNote();

    expect(card).toHaveAttribute("tabindex", "0");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("aria-label", "1 leu, 1917");
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("edit mode always shows the front, whatever the pointer does", async () => {
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));
    await openSummer();

    const card = await screen.findByRole("button", { name: "1 leu, 1917" });
    await userEvent.hover(card);
    act(() => card.focus());

    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
  });
});
