import { MemoryRouter, useLocation } from "react-router-dom";
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
  reorderNodes: vi.fn(),
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
import { SHOWCASE_ROUTES } from "./lib/routes.js";

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
// note member (which fixes its derived cover) and a deeper "Deep" grouping
// that also holds a note so drill navigation can reach it in view mode (empty
// groupings stay hidden there).
function summerTree({ coverNote = null } = {}) {
  const sub = groupingNode({
    id: 20,
    name: "Sub",
    coverNote,
    children: [
      noteNode(11, DERIVED_NOTE),
      groupingNode({
        id: 30,
        name: "Deep",
        children: [noteNode(12, DERIVED_NOTE)],
      }),
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
  return (
    <>
      <output data-testid="pathname">{location.pathname}</output>
      <output data-testid="search">{location.search}</output>
    </>
  );
}

function currentSearch() {
  return screen.getByTestId("search").textContent;
}

function groupingCard(name) {
  return screen.getByRole("button", { name: `Open grouping ${name}` });
}

async function openSub() {
  await userEvent.click(groupingCard("Sub"));
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
  test("categories expand inline but groupings still drill", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
    expect(groupingCard("Sub")).toBeInTheDocument();
    // Sub's own children stay hidden until Sub is opened.
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();
  });

  test("the expanded root shows its grouping cards", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    expect(await screen.findByRole("heading", { name: "Summer" }))
      .toBeInTheDocument();
    expect(groupingCard("Sub")).toBeInTheDocument();
  });

  test("clicking a grouping drills in; the breadcrumb goes back", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Sub" }));

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
    expect(
      screen.queryByRole("button", { name: "Up" }),
    ).not.toBeInTheDocument();

    await userEvent.click(within(breadcrumb).getByText("My showcase"));

    expect(await screen.findByRole("heading", { name: "Summer" }))
      .toBeInTheDocument();
    expect(groupingCard("Sub")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();
  });

  test("the category segment is plain text and never navigates", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Sub" }));

    const breadcrumb = await screen.findByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    // The category has no level of its own, so it renders as text, not a
    // control — clicking it must not leave the grouping.
    expect(
      within(breadcrumb).queryByRole("button", { name: "Summer" }),
    ).not.toBeInTheDocument();
    expect(within(breadcrumb).getByText("Summer").tagName).toBe("SPAN");
  });

  test("the breadcrumb jumps straight to an ancestor grouping level", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Sub" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Deep" }));

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("Sub"));

    expect(
      await screen.findByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
  });

  test("the showcase breadcrumb returns to the top level", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Sub" }));

    const breadcrumb = screen.getByRole("navigation", {
      name: "Showcase breadcrumb",
    });
    await userEvent.click(within(breadcrumb).getByText("My showcase"));

    expect(
      await screen.findByRole("heading", { name: "Summer" }),
    ).toBeInTheDocument();
  });

  test("edit mode syncs the drill state to the URL without leaving the edit route", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await userEvent.click(await screen.findByRole("button", { name: "Open grouping Sub" }));

    expect(groupingCard("Deep")).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/portfolio/showcases/1/edit",
    );
    await waitFor(() => {
      expect(currentSearch()).toBe("?node=20");
    });
  });
});

describe("grouping cover", () => {
  test("a grouping card shows the first note beneath it as its cover", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const image = (await screen.findByRole("button", { name: "Open grouping Sub" })).querySelector("img");
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
    renderAt(SHOWCASE_ROUTES.showcase(1));

    const image = (await screen.findByRole("button", { name: "Open grouping Sub" })).querySelector("img");
    expect(image).toHaveAttribute(
      "src",
      "/api/images/notes/200/front-thumbnail.jpg?v=2024-06-01",
    );
  });

  test("an empty grouping shows its name and a placeholder in edit mode", async () => {
    const emptyGrouping = groupingNode({ id: 20, name: "Sub" });
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        { ...summerTree(), children: [noteNode(11, DERIVED_NOTE), emptyGrouping] },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));

    const card = await screen.findByRole("button", { name: "Open grouping Sub" });
    expect(card).toHaveTextContent("Sub");
    expect(card.querySelector("img")).toBeNull();
  });

  test("an empty grouping stays hidden in view mode", async () => {
    const emptyGrouping = groupingNode({ id: 20, name: "Sub" });
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        { ...summerTree(), children: [noteNode(11, DERIVED_NOTE), emptyGrouping] },
      ],
    });
    renderAt(SHOWCASE_ROUTES.showcase(1));

    await screen.findByRole("heading", { name: "Summer" });
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
  });

  test("an empty nested grouping stays hidden on its drilled level in view mode", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [
        {
          ...summerTree(),
          children: [
            {
              ...groupingNode({ id: 20, name: "Sub" }),
              children: [
                noteNode(11, DERIVED_NOTE),
                groupingNode({ id: 30, name: "Deep" }),
              ],
            },
          ],
        },
      ],
    });
    renderAt(`${SHOWCASE_ROUTES.showcase(1)}?node=20`);

    expect(
      await screen.findByRole("button", { name: "1, 2020" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();
  });

  test("a grouping holding only empty groupings stays hidden in view mode", async () => {
    const nestedEmpty = groupingNode({
      id: 30,
      name: "Deep",
      children: [groupingNode({ id: 31, name: "Deeper" })],
    });
    const parent = groupingNode({
      id: 20,
      name: "Sub",
      children: [nestedEmpty],
    });
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [{ ...summerTree(), children: [noteNode(11, DERIVED_NOTE), parent] }],
    });

    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("heading", { name: "Summer" });
    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1, 2020" }),
    ).toBeInTheDocument();
  });
});

describe("editing groupings on the canvas", () => {
  test("creating a grouping stages it and saves it on Save", async () => {
    createShowcaseNode.mockResolvedValue({
      node: groupingNode({ id: 40, name: "New group" }),
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    await userEvent.click(
      screen.getByRole("button", { name: "Add grouping" }),
    );
    await userEvent.type(screen.getByLabelText("Grouping name"), "New group");
    await userEvent.click(screen.getByRole("button", { name: "Add grouping" }));

    expect(groupingCard("New group")).toBeInTheDocument();
    expect(createShowcaseNode).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createShowcaseNode).toHaveBeenCalledWith(1, {
        type: "grouping",
        parent_id: 10,
        name: "New group",
      });
    });
  });

  test("renaming a grouping stages the rename and saves it on Save", async () => {
    updateNode.mockResolvedValue({
      node: groupingNode({ id: 20, name: "Renamed" }),
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    await userEvent.click(
      screen.getByRole("button", { name: "Rename Sub" }),
    );
    const input = screen.getByLabelText("New name for Sub");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed");
    const saves = screen.getAllByRole("button", { name: "Save" });
    await userEvent.click(saves[saves.length - 1]);

    expect(groupingCard("Renamed")).toBeInTheDocument();
    expect(updateNode).not.toHaveBeenCalled();

    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(20, { name: "Renamed" });
    });
  });

  test("removing a grouping stages the removal and deletes on Save", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Sub" }),
    );

    expect(
      screen.queryByRole("button", { name: "Open grouping Sub" }),
    ).not.toBeInTheDocument();
    expect(deleteNode).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(deleteNode).toHaveBeenCalledWith(20);
    });
  });

  test("drills one level at a time and never renders grandchildren inline", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });

    // Sub's own child note and the deeper grouping are not on the Summer level.
    expect(
      screen.queryByRole("button", { name: "1, 2020" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open grouping Deep" }),
    ).not.toBeInTheDocument();

    await userEvent.click(groupingCard("Sub"));

    expect(
      await screen.findByRole("button", { name: "1, 2020" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open grouping Deep" }),
    ).toBeInTheDocument();
  });
});

describe("setting a grouping cover from the canvas", () => {
  test("setting the cover stages it and saves it on Save", async () => {
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });
    await userEvent.click(groupingCard("Sub"));

    // The derived cover means no manual-cover control is shown yet.
    expect(
      screen.queryByRole("button", { name: "Clear cover" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Set as cover" }));

    // Staged locally: the clear control appears with no network call.
    expect(updateNode).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Clear cover" }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(20, { cover_note_id: 100 });
    });
  });

  test("clearing a manual cover stages it and saves it on Save", async () => {
    getShowcaseTree.mockResolvedValue({
      showcase_id: 1,
      nodes: [summerTree({ coverNote: MANUAL_NOTE })],
    });
    renderAt(SHOWCASE_ROUTES.showcaseEdit(1));
    await screen.findByRole("button", { name: "Open grouping Sub" });
    await userEvent.click(groupingCard("Sub"));

    const clear = await screen.findByRole("button", { name: "Clear cover" });
    await userEvent.click(clear);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Clear cover" }),
      ).not.toBeInTheDocument();
    });
    expect(updateNode).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateNode).toHaveBeenCalledWith(20, { cover_note_id: null });
    });
  });
});
