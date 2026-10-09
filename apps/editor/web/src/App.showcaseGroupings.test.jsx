import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase grouping tests render the real shell (sidebar + routes) with the
// web API mocked. The drill, the grouping card, and the derived/manual cover are
// observed through the route, not through a component's internals.
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
  createShowcaseNode,
  deleteNode,
  getCategories,
  getCollections,
  getHealth,
  getShowcases,
  getShowcaseTree,
  updateNode,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { PORTFOLIO_ROUTES } from "./lib/routes.js";

const DERIVED_NOTE = {
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

const MANUAL_NOTE = {
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
    parent_node_id: null,
    note_id: note.id,
    cover_note_id: null,
    position: 1,
    note,
    cover_note: null,
    children: [],
  };
}

function groupingNode({ id, name, children = [], coverNote = null }) {
  return {
    id,
    node_type: "grouping",
    name,
    category_id: null,
    parent_node_id: 10,
    note_id: null,
    cover_note_id: coverNote ? coverNote.id : null,
    position: 1,
    note: null,
    cover_note: coverNote,
    children,
  };
}

// A category placement "Summer" holding a "Sub" grouping. The grouping has a
// note member (which fixes its derived cover) and a deeper "Deep" grouping.
function summerTree({ coverNote = null } = {}) {
  const sub = groupingNode({
    id: 20,
    name: "Sub",
    coverNote,
    children: [
      noteNode(11, DERIVED_NOTE),
      groupingNode({ id: 30, name: "Deep" }),
    ],
  });

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
    children: [sub],
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

function groupingCard(name) {
  return screen.getByRole("button", { name: `Open grouping ${name}` });
}

async function openSummer() {
  await userEvent.click(
    await screen.findByRole("button", { name: "Open category Summer" }),
  );
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
  deleteNode.mockResolvedValue({ success: true });
});

describe("grouping drill navigation", () => {
  test("nothing expands inline: a grouping is hidden until its parent is opened", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
  });

  test("opening a category shows its grouping cards", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    expect(groupingCard("Sub")).toBeInTheDocument();
  });

  test("double-clicking a grouping drills in; Up and the breadcrumb go back", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    await userEvent.dblClick(groupingCard("Sub"));

    expect(
      await screen.findByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    expect(within(breadcrumb).getByText("My showcase")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Summer")).toBeInTheDocument();
    expect(within(breadcrumb).getByText("Sub")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Up" }));

    expect(groupingCard("Sub")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();
  });

  test("the breadcrumb jumps straight to an ancestor level", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();
    await userEvent.dblClick(groupingCard("Sub"));

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("Summer"));

    expect(
      await screen.findByRole("button", { name: "Open grouping Sub" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open category Summer" }),
    ).not.toBeInTheDocument();
  });

  test("the showcase breadcrumb returns to the top level", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("My showcase"));

    expect(
      await screen.findByRole("button", { name: "Open category Summer" }),
    ).toBeInTheDocument();
  });
});

describe("grouping cover", () => {
  test("a grouping card shows the first note beneath it as its cover", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    const image = groupingCard("Sub").querySelector("img");
    expect(image).toHaveAttribute(
      "src",
      "/api/images/notes/100/front-thumbnail.jpg?v=2024-05-01",
    );
  });

  test("the manual cover wins over the derived note", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [summerTree({ coverNote: MANUAL_NOTE })],
    });
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    const image = groupingCard("Sub").querySelector("img");
    expect(image).toHaveAttribute(
      "src",
      "/api/images/notes/200/front-thumbnail.jpg?v=2024-06-01",
    );
  });

  test("a grouping with no resolvable note shows its name and a placeholder", async () => {
    const emptyGrouping = groupingNode({ id: 20, name: "Sub" });
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [{ ...summerTree(), children: [emptyGrouping] }],
    });
    renderAt(PORTFOLIO_ROUTES.showcase(1));
    await openSummer();

    const card = groupingCard("Sub");
    expect(card).toHaveTextContent("Sub");
    expect(card.querySelector("img")).toBeNull();
  });
});

describe("editing groupings on the canvas", () => {
  test("creating a grouping posts it under the current node", async () => {
    createShowcaseNode.mockResolvedValue({
      node: groupingNode({ id: 40, name: "New group" }),
    });
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));
    await openSummer();

    await userEvent.click(
      screen.getByRole("button", { name: "Create a grouping" }),
    );
    await userEvent.type(screen.getByLabelText("Grouping name"), "New group");
    await userEvent.click(screen.getByRole("button", { name: "Add grouping" }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "grouping",
        parent_id: 10,
        name: "New group",
      });
    });
    expect(groupingCard("New group")).toBeInTheDocument();
  });

  test("renaming a grouping updates the card", async () => {
    updateNode.mockResolvedValue({
      node: groupingNode({ id: 20, name: "Renamed" }),
    });
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));
    await openSummer();

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Sub" }),
    );
    const input = screen.getByLabelText("New name for Sub");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(20, { name: "Renamed" });
    });
    expect(groupingCard("Renamed")).toBeInTheDocument();
  });

  test("removing a grouping drops its subtree", async () => {
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));
    await openSummer();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Sub" }),
    );

    await waitFor(() => {
      expect(deleteNode).toHaveBeenCalledWith(20);
    });
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
  });
});
