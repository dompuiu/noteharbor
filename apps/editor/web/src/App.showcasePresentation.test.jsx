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
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

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

async function openSub() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Open grouping Sub" }),
  );
}

describe("browsing a showcase read-only", () => {
  test("lands on expanded Categories with their contents inline", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    // Empty categories stay hidden in view mode so the presentation never
    // shows an empty section.
    expect(
      screen.queryByRole("heading", { name: "Vienna" }),
    ).not.toBeInTheDocument();
    // A category always shows its contents: the child grouping and note are
    // visible without opening anything.
    expect(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1 leu, 1917" }),
    ).toBeInTheDocument();
  });

  test("a Category shows its direct children in manual order", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const noteCard = await screen.findByRole("button", { name: "1 leu, 1917" });
    const groupingCard = screen.getByRole("button", {
      name: "Open grouping Sub",
    });

    const section = screen.getByRole("region", { name: "Category Summer" });
    const cards = within(section).getAllByRole("button");
    expect(cards.indexOf(noteCard)).toBeLessThan(cards.indexOf(groupingCard));
  });

  test("opening a Grouping shows its direct children", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSub();

    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("an empty showcase shows its message", async () => {
    getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [] });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
  });

  test("an empty category stays hidden inline", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("heading", { name: "Summer" });
    expect(
      screen.queryByRole("heading", { name: "Vienna" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("No notes here yet.")).not.toBeInTheDocument();
  });
});

describe("view-mode URL sync", () => {
  test("the root has no node parameter and drilling a grouping adds one", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("heading", { name: "Summer" });

    expect(currentSearch()).toBe("");

    await openSub();
    expect(currentSearch()).toBe("?node=20");
  });

  test("the breadcrumb moves back to the expanded root", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSub();
    expect(currentSearch()).toBe("?node=20");

    expect(screen.queryByRole("button", { name: "Up" })).not.toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("My showcase"));
    expect(currentSearch()).toBe("");
  });

  test("a deep link opens the node named in the URL", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcase(1)}?node=20`);

    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("a category deep link shows the expanded root", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcase(1)}?node=10`);

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
  });

  test("each drill is a history entry so the browser Back button works", async () => {
    window.history.replaceState(null, "", SHOWCASE_ROUTES.showcase(1));
    render(<BrowserRouter>{shell()}</BrowserRouter>);
    await screen.findByRole("button", { name: "Open grouping Sub" });

    await userEvent.click(
      screen.getByRole("button", { name: "Open grouping Sub" }),
    );
    await waitFor(() => {
      expect(window.location.search).toBe("?node=20");
    });

    await act(async () => {
      window.history.back();
    });

    await waitFor(() => {
      expect(window.location.search).toBe("");
    });
    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
  });

  test("edit mode keeps the drill state out of the URL", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    expect(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
    expect(currentSearch()).toBe("");
  });
});

describe("view/edit mode switching", () => {
  function currentPath() {
    return screen.getByTestId("pathname").textContent;
  }

  test("a bare showcase URL redirects to the view mode with the drill kept", async () => {
    renderAt("/portfolio/showcases/1?node=20");

    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(1));
    });
    expect(currentSearch()).toBe("?node=20");
    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("the Edit toggle lands on the same drilled level", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await openSub();

    await userEvent.click(screen.getByRole("link", { name: "Edit" }));

    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcaseEdit(1));
    });
    // The edit address keeps naming the drilled level.
    await waitFor(() => {
      expect(currentSearch()).toBe("?node=20");
    });
    const breadcrumb = await screen.findByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    expect(within(breadcrumb).getByText("Sub")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("Cancel returns to the same drilled level in view", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await userEvent.click(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    );
    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(currentPath()).toBe(SHOWCASE_ROUTES.showcase(1));
    });
    expect(currentSearch()).toBe("?node=20");
    expect(
      screen.getByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
  });

  test("a drilled edit URL restores the level on load", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcaseEdit(1)}?node=20`);

    expect(
      await screen.findByRole("button", { name: "10 lei, 1930" }),
    ).toBeInTheDocument();
    expect(currentSearch()).toBe("?node=20");
  });

  test("an unresolvable edit entry falls back to the root", async () => {
    renderAt(`${SHOWCASE_ROUTES.showcaseEdit(1)}?node=999`);

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(currentSearch()).toBe("");
    });
  });
});

describe("entering a node", () => {
  test("announces the showcase and the drilled grouping in a polite live region", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");

    await waitFor(() => {
      expect(status).toHaveTextContent("My showcase, 1 items");
    });

    await openSub();

    await waitFor(() => {
      expect(status).toHaveTextContent("Sub, 1 items");
    });
  });
});

describe("the note card in view mode", () => {
  async function openWithNote() {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    return screen.findByRole("button", { name: "1 leu, 1917" });
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

  test("a tap leaves the front showing and never navigates", async () => {
    const card = await openWithNote();
    const searchBefore = currentSearch();

    fireEvent.click(card);

    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
    expect(currentSearch()).toBe(searchBefore);

    fireEvent.click(card);
    expect(card).toHaveAttribute("aria-pressed", "false");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
  });

  test("a card is focusable and reports its label and pressed state", async () => {
    const card = await openWithNote();

    expect(card).toHaveAttribute("tabindex", "0");
    expect(card).toHaveAttribute("role", "button");
    expect(card).toHaveAttribute("aria-label", "1 leu, 1917");
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  test("edit mode always shows the front, whatever the pointer does", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const card = await screen.findByRole("button", { name: "1 leu, 1917" });
    await userEvent.hover(card);
    act(() => card.focus());

    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "/api/images/notes/100/front.jpg?v=rev-100",
    );
  });
});
