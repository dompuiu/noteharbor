import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SHOWCASE_ROUTES } from "./lib/routes.js";

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
  moveNode: vi.fn(),
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
  getCategories,
  getCollections,
  getHealth,
  getShowcaseTree,
  getShowcases,
  moveNode,
} from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";

const NOTE_A = {
  id: 100,
  denomination: "1",
  issue_date: "2020",
  images: [],
};
const NOTE_B = {
  id: 200,
  denomination: "5",
  issue_date: "1990",
  images: [],
};
const NOTE_C = {
  id: 300,
  denomination: "10",
  issue_date: "1910",
  images: [],
};

function noteNode(id, note, parent = 10) {
  return {
    id,
    node_type: "note",
    name: null,
    category_id: null,
    parent_node_id: parent,
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
      groupingNode({ id: 20, name: "Empty" }),
      groupingNode({
        id: 21,
        name: "Gold",
        children: [
          noteNode(30, NOTE_C, 21),
          groupingNode({ id: 31, name: "Deep", children: [] }),
        ],
      }),
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

function mockRect(element, width = 200, height = 100) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: height,
    height,
    left: 0,
    right: width,
    toJSON: () => ({}),
    top: 0,
    width,
    x: 0,
    y: 0,
  });
}

async function drag(source, target, { clientX = 100, clientY = 50 } = {}) {
  const dataTransfer = makeDataTransfer();

  await act(async () => {
    source.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
  });
  await act(async () => {
    target.dispatchEvent(
      dragEvent("dragover", { clientX, clientY, dataTransfer }),
    );
  });

  return dataTransfer;
}

async function drop(target, dataTransfer, { clientX = 100, clientY = 50 } = {}) {
  await act(async () => {
    target.dispatchEvent(
      dragEvent("drop", { clientX, clientY, dataTransfer }),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
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
  moveNode.mockResolvedValue({ node: {} });
});

describe("showcase nesting", () => {
  test("dropping a note on a grouping's middle moves it inside", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Empty" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Empty");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await drop(target, dataTransfer);
    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 20, 0);
    });

    const emptyCell = cellFor("Open grouping Empty");
    expect(
      within(emptyCell).getByText(/1 note/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "2020 · 1" }),
    ).not.toBeInTheDocument();
  });

  test("holding a grouping's middle opens its children as precise drop rows", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Gold");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    const meter = document.querySelector(".showcase-spring-meter");
    expect(meter).not.toBeNull();
    // The hold fills under the picture, inside the grouping's photo well.
    expect(meter.closest(".showcase-grouping-well")).not.toBeNull();
    expect(document.querySelector(".showcase-spring-hold")).toHaveTextContent(
      /hold to open/i,
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    const drawer = document.querySelector(".showcase-spring-drawer");
    expect(drawer).not.toBeNull();
    expect(within(drawer).getByText(/Inside/)).toBeInTheDocument();
    const row = drawer.querySelector(".showcase-spring-row");
    mockRect(row, 240, 30);

    act(() => {
      row.dispatchEvent(
        dragEvent("dragover", {
          clientX: 100,
          clientY: 10,
          dataTransfer,
        }),
      );
    });
    act(() => {
      row.dispatchEvent(
        dragEvent("drop", { clientX: 100, clientY: 10, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 21, 0);
    });
  });

  test("the open spring drawer survives the pointer crossing its card's edge", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Gold");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    const drawer = document.querySelector(".showcase-spring-drawer");
    expect(drawer).not.toBeNull();

    // The card ends above its drawer and a gap separates them; the browser
    // fires a leave on the cell there, which must not unmount the rows.
    await act(async () => {
      target.dispatchEvent(
        dragEvent("dragleave", {
          dataTransfer,
          relatedTarget: document.body,
        }),
      );
    });

    expect(document.querySelector(".showcase-spring-drawer")).not.toBeNull();

    // The drawer's own surface (its title and padding) is a drop target too:
    // releasing there appends to the grouping rather than doing nothing.
    mockRect(drawer, 240, 120);
    act(() => {
      drawer.dispatchEvent(
        dragEvent("dragover", {
          clientX: 100,
          clientY: 10,
          dataTransfer,
        }),
      );
    });
    act(() => {
      drawer.dispatchEvent(
        dragEvent("drop", { clientX: 100, clientY: 10, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 21, 2);
    });
  });

  test("the open drawer survives a pass over another container's middle", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Gold");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    expect(
      document.querySelector(".showcase-spring-drawer"),
    ).toHaveAttribute("data-showcase-spring", "21");

    const other = cellFor("Open grouping Empty");
    mockRect(other);
    await act(async () => {
      other.dispatchEvent(
        dragEvent("dragover", {
          clientX: 100,
          clientY: 50,
          dataTransfer,
        }),
      );
    });

    // The new spring is still filling; the rows already open must not unmount
    // until the 450 ms swap.
    expect(
      document.querySelector(".showcase-spring-drawer"),
    ).toHaveAttribute("data-showcase-spring", "21");
  });

  test("Escape closes the open drawer before it ends the drag", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Gold");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    expect(document.querySelector(".showcase-spring-drawer")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(document.querySelector(".showcase-spring-drawer")).toBeNull();
    expect(document.querySelector(".showcase-drag-outcome")).not.toBeNull();
  });

  test("a nested grouping's Into row appends to the end of that grouping", async () => {    const tree = summerTree();
    const gold = tree.children.find((node) => node.id === 21);
    gold.children = [
      noteNode(30, NOTE_C, 21),
      groupingNode({
        id: 31,
        name: "Deep",
        children: [noteNode(13, NOTE_B, 31)],
      }),
    ];
    getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: [tree] });

    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Gold");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 520));
    });

    const drawer = document.querySelector(".showcase-spring-drawer");
    const into = drawer.querySelector(".showcase-spring-into");
    expect(into).not.toBeNull();
    mockRect(into, 40, 20);

    act(() => {
      into.dispatchEvent(
        dragEvent("dragover", { clientX: 20, clientY: 10, dataTransfer }),
      );
    });
    act(() => {
      into.dispatchEvent(
        dragEvent("drop", { clientX: 20, clientY: 10, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 31, 1);
    });
  });

  test("the menu moves an item out of its grouping in one level", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });
    await user.click(screen.getByRole("button", { name: "Open grouping Gold" }));

    await user.click(
      await screen.findByRole("button", { name: "Actions for 10 1910" }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Move out one level" }),
    );

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(30, 10, 4);
    });
  });

  test("a card already on its level has no Move out action", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    await user.click(
      screen.getByRole("button", { name: "Actions for 1 2020" }),
    );

    expect(
      screen.queryByRole("menuitem", { name: "Move out one level" }),
    ).not.toBeInTheDocument();
  });

  test("the item menu moves a card into another grouping", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    await user.click(screen.getByRole("button", { name: "Actions for 1 2020" }));
    await user.click(screen.getByRole("menuitem", { name: "Move into…" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Move “1 2020” into/),
    ).toBeInTheDocument();

    const option = within(dialog)
      .getAllByRole("radio")
      .find((radio) => radio.closest("label").textContent.includes("Gold"));
    await user.click(option);
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 21, 2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  test("the move dialog defaults to the current level", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    await user.click(screen.getByRole("button", { name: "Actions for 1 2020" }));
    await user.click(screen.getByRole("menuitem", { name: "Move into…" }));

    const dialog = screen.getByRole("dialog");
    const checked = within(dialog).getByRole("radio", { checked: true });
    expect(checked.closest("label").textContent).toContain("Summer");

    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 10, 3);
    });
  });

  test("the success toast offers Undo for the previous position", async () => {
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Empty" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Empty");
    mockRect(target);
    const dataTransfer = await drag(source, target);
    await drop(target, dataTransfer);

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(11, 20, 0);
    });

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => {
      expect(moveNode).toHaveBeenLastCalledWith(11, 10, 2);
    });
  });

  test("the ancestor rail moves a nested note out to its category", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });
    await user.click(screen.getByRole("button", { name: "Open grouping Gold" }));
    await screen.findByRole("button", { name: "1910 · 10" });

    const source = cellFor("1910 · 10");
    const dataTransfer = await drag(source, source);

    const rail = document.querySelector(".showcase-drag-levels");
    expect(rail).not.toBeNull();
    expect(within(rail).getByText("Summer")).toBeInTheDocument();

    const chip = [...rail.querySelectorAll(".showcase-drag-level")].find(
      (button) => button.textContent === "Summer",
    );
    mockRect(chip, 120, 24);

    await act(async () => {
      chip.dispatchEvent(
        dragEvent("dragover", { clientX: 60, clientY: 12, dataTransfer }),
      );
    });
    await act(async () => {
      chip.dispatchEvent(
        dragEvent("drop", { clientX: 60, clientY: 12, dataTransfer }),
      );
    });

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(30, 10, 4);
    });
  });

  test("a grouping's move dialog enables ancestors and refuses its own subtree", async () => {
    const user = userEvent.setup();
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Gold" });

    await user.click(screen.getByRole("button", { name: "Actions for Gold" }));
    await user.click(screen.getByRole("menuitem", { name: "Move into…" }));

    const dialog = screen.getByRole("dialog");
    const optionFor = (name) =>
      within(dialog)
        .getAllByRole("radio")
        .find((radio) => radio.closest("label").textContent.includes(name));

    expect(optionFor("Summer")).not.toBeDisabled();
    expect(optionFor("Gold")).toBeDisabled();
    expect(optionFor("Deep")).toBeDisabled();

    await user.click(optionFor("Summer"));
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(moveNode).toHaveBeenCalledWith(21, 10, 3);
    });
  });

  test("a failed move restores the card and reports the error", async () => {
    moveNode.mockRejectedValueOnce(new Error("Parent node not found."));
    renderAt(SHOWCASE_ROUTES.showcase(1));
    await screen.findByRole("button", { name: "Open grouping Empty" });

    const source = cellFor("2020 · 1");
    const target = cellFor("Open grouping Empty");
    mockRect(target);
    const dataTransfer = await drag(source, target);

    await drop(target, dataTransfer);

    await waitFor(() => {
      expect(screen.getAllByText("Parent node not found.").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("button", { name: "2020 · 1" }),
    ).toBeInTheDocument();
  });
});
