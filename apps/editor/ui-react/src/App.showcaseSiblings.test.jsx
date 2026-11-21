import { MemoryRouter, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The sibling chip and Compare tray drive the real shell with the web API
// mocked, following the other Showcase app tests. The server owns the sibling
// key, so the tray's list is a mocked endpoint response.
vi.mock("./lib/api.js", () => ({
  createCatalogEntry: vi.fn(),
  createCategory: vi.fn(),
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  createShowcaseNode: vi.fn(),
  deleteCategory: vi.fn(),
  deleteCollection: vi.fn(),
  deleteNode: vi.fn(),
  deleteShowcase: vi.fn(),
  duplicateNode: vi.fn(),
  getCategories: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getAllNotes: vi.fn(),
  getNoteSiblings: vi.fn(),
  getShowcases: vi.fn(),
  getShowcaseTree: vi.fn(),
  renameCategory: vi.fn(),
  renameCollection: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
  updateCatalogEntry: vi.fn(),
  updateNode: vi.fn(),
  updateNote: vi.fn(),
  reorderNodes: vi.fn(),
  replaceCatalogEntryWithNote: vi.fn(),
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
  getNoteSiblings,
  getShowcases,
  getShowcaseTree,
  updateNode,
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

function note(id, overrides = {}) {
  return {
    collection_id: 1,
    id,
    catalog_number: "22a",
    denomination: "1 leu",
    issue_date: "1917",
    grading_company: "PMG",
    grade: "66 EPQ",
    serial: "A.1",
    images: [FRONT(id)],
    owned: true,
    tags: [],
    updated_at: `rev-${id}`,
    ...overrides,
  };
}

const CURRENT = note(101, { images: [FRONT(101), BACK(101)] });
const OWNED_SIBLING = note(201, {
  collection_id: 2,
  catalog_number: "23b",
  denomination: "2 lei",
  issue_date: "1919",
  serial: "B.2",
  grade: "67 EPQ",
  owned: true,
  tags: [{ id: 1, name: "rare" }],
  images: [FRONT(201), BACK(201)],
});
const IN_SHOWCASE_SIBLING = note(202, {
  collection_id: 1,
  catalog_number: "24c",
  denomination: "5 lei",
  issue_date: "1920",
  serial: "C.3",
  grade: "65 EPQ",
  owned: true,
});
const SEEN_SIBLING = note(203, {
  collection_id: 2,
  catalog_number: "25d",
  denomination: "10 lei",
  issue_date: "1921",
  serial: "D.4",
  grade: "64",
  owned: false,
});

function noteNode(id, theNote, position = 1, siblingCount = null) {
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
    ...(siblingCount == null ? {} : { sibling_count: siblingCount }),
    children: [],
  };
}

function categoryNode(children = []) {
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
    children,
  };
}

function siblingTree(count = 3) {
  return [
    categoryNode([
      noteNode(30, CURRENT, 1, count),
      noteNode(31, IN_SHOWCASE_SIBLING, 2, 0),
    ]),
  ];
}

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="hash">{location.hash}</span>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CollectionsProvider>
        <ShowcasesProvider>
          <LocationProbe />
          <ShellContent />
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

async function openShowcase(tree = siblingTree()) {
  getShowcaseTree.mockResolvedValue({ showcase_id: 1, nodes: tree });
  const result = renderAt(SHOWCASE_ROUTES.showcase(1));
  await screen.findByRole("heading", { name: "Summer" });
  return result;
}

function chip(name = /^Show 3 sibling notes/) {
  return screen.getByRole("button", { name });
}

function cardButton(label) {
  return screen.getByRole("button", { name: label });
}

async function openTray() {
  await openShowcase();
  const user = userEvent.setup();
  await user.click(chip());
  return {
    tray: await screen.findByRole("dialog", {
      name: "Pick 22a · 1917 · 1 leu",
    }),
    user,
  };
}

function firstAvailableSibling(tray) {
  return within(tray).getByRole("button", {
    name: "Select Pick 23b · 1919 · 2 lei",
  });
}

async function waitForFirstSiblingFocus(tray) {
  await waitFor(() => expect(firstAvailableSibling(tray)).toHaveFocus());
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [
      { id: 1, is_default: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
    ],
  });
  getShowcases.mockResolvedValue({
    showcases: [
      {
        id: 1,
        name: "My showcase",
        catalog_entry_count: 2,
        entry_count: 2,
        note_count: 2,
        owned_count: 2,
      },
    ],
  });
  getCategories.mockResolvedValue({ categories: [] });
  getAllNotes.mockResolvedValue({ notes: [CURRENT] });
  getNoteSiblings.mockResolvedValue([
    OWNED_SIBLING,
    IN_SHOWCASE_SIBLING,
    SEEN_SIBLING,
  ]);
  updateNode.mockImplementation(async (id, payload) => ({
    node: noteNode(
      id,
      [CURRENT, OWNED_SIBLING, IN_SHOWCASE_SIBLING, SEEN_SIBLING].find(
        (entry) => entry.id === payload.note_id,
      ) ?? CURRENT,
      1,
      3,
    ),
  }));
});

describe("the sibling chip", () => {
  test("reads 3 siblings and sits outside the card's primary button", async () => {
    await openShowcase();

    expect(chip()).toHaveTextContent("3 siblings");
    expect(cardButton("Pick 22a · 1917 · 1 leu")).not.toContainElement(chip());
  });

  test("reads 1 sibling in the singular", async () => {
    await openShowcase(siblingTree(1));

    expect(
      screen.getByRole("button", { name: /^Show 1 sibling note/ }),
    ).toHaveTextContent("1 sibling");
  });

  test("is absent when the count is zero or missing", async () => {
    await openShowcase([
      categoryNode([noteNode(30, CURRENT, 1, 0), noteNode(31, note(150), 2)]),
    ]);

    expect(
      screen.queryByRole("button", { name: /sibling notes? with the same/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the compare tray", () => {
  test("opens from the chip with the current note and fresh siblings", async () => {
    const { tray } = await openTray();

    expect(getNoteSiblings).toHaveBeenCalledWith(101);
    expect(
      within(tray).getByText(
        "3 siblings · 2 available · 1 already in this showcase",
      ),
    ).toBeInTheDocument();
    expect(within(tray).getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(within(tray).getByText("A.1")).toBeInTheDocument();
    expect(within(tray).getByText("66 EPQ PMG")).toBeInTheDocument();
    expect(within(tray).getByText("Current note")).toBeInTheDocument();
    expect(
      within(tray).getByRole("button", {
        name: "Select Pick 23b · 1919 · 2 lei",
      }),
    ).toBeInTheDocument();
    expect(
      within(tray).getByRole("button", {
        name: "Select Pick 25d · 1921 · 10 lei",
      }),
    ).toBeInTheDocument();
  });

  test("the header count comes from the fetched list, not the tree", async () => {
    getNoteSiblings.mockResolvedValue([OWNED_SIBLING, SEEN_SIBLING]);

    const { tray } = await openTray();

    expect(
      within(tray).getByText("2 siblings · 2 available"),
    ).toBeInTheDocument();
  });

  test("marks a sibling already in this showcase and disables it", async () => {
    const { tray } = await openTray();

    const here = within(tray).getByRole("button", {
      name: "Pick 24c · 1920 · 5 lei is in this showcase",
    });
    expect(here).toBeDisabled();
    expect(here).toHaveTextContent("In this showcase");
  });

  test("opens with focus on the first available sibling", async () => {
    const { tray } = await openTray();

    await waitForFirstSiblingFocus(tray);
  });

  test("arrows walk the available siblings, skip in-showcase cards, and reach the pinned note", async () => {
    const { tray, user } = await openTray();
    const owned = within(tray).getByRole("button", {
      name: "Select Pick 23b · 1919 · 2 lei",
    });
    const seen = within(tray).getByRole("button", {
      name: "Select Pick 25d · 1921 · 10 lei",
    });
    const currentPhoto = within(tray).getByRole("button", {
      name: "View images of the current note",
    });

    await waitFor(() => expect(owned).toHaveFocus());

    // The in-showcase sibling sits between these two and is not a stop.
    await user.keyboard("{ArrowRight}");
    expect(seen).toHaveFocus();
    await user.keyboard("{j}");
    expect(seen).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(owned).toHaveFocus();

    // Left from the first sibling reaches the pinned Note for comparison.
    await user.keyboard("{k}");
    expect(currentPhoto).toHaveFocus();

    await user.keyboard("{End}");
    expect(seen).toHaveFocus();
    await user.keyboard("{Home}");
    expect(currentPhoto).toHaveFocus();
  });

  test("arrows enter the filmstrip from the footer at the walking end", async () => {
    const { tray, user } = await openTray();
    const cancel = within(tray).getByRole("button", { name: "Cancel" });
    const currentPhoto = within(tray).getByRole("button", {
      name: "View images of the current note",
    });
    const last = within(tray).getByRole("button", {
      name: "Select Pick 25d · 1921 · 10 lei",
    });

    await waitForFirstSiblingFocus(tray);

    act(() => cancel.focus());
    await user.keyboard("{ArrowLeft}");
    expect(last).toHaveFocus();

    act(() => cancel.focus());
    await user.keyboard("{ArrowDown}");
    expect(currentPhoto).toHaveFocus();
  });

  test("Enter selects the focused sibling, then Replace note commits it", async () => {
    const { tray, user } = await openTray();
    const replace = within(tray).getByRole("button", { name: "Replace note" });

    await waitForFirstSiblingFocus(tray);
    expect(replace).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(replace).toBeEnabled();
    await waitFor(() => expect(replace).toHaveFocus());

    // Arrows from the footer return to the selected card without losing the
    // pick, then keep walking from there.
    await user.keyboard("{ArrowRight}");
    const picked = within(tray).getByRole("button", {
      name: "Pick 23b · 1919 · 2 lei selected",
    });
    expect(picked).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(
      within(tray).getByRole("button", {
        name: "Select Pick 25d · 1921 · 10 lei",
      }),
    ).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(picked).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(replace).toBeEnabled();
    await waitFor(() => expect(replace).toHaveFocus());
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(updateNode).toHaveBeenCalledWith(30, { note_id: 201 }),
    );
  });

  test("Space selects the focused sibling too", async () => {
    const { tray, user } = await openTray();
    const replace = within(tray).getByRole("button", { name: "Replace note" });

    await waitForFirstSiblingFocus(tray);

    await user.keyboard(" ");
    expect(replace).toBeEnabled();
    await waitFor(() => expect(replace).toHaveFocus());
  });

  test("replaces in place with the selected sibling and undoes it", async () => {
    const { tray, user } = await openTray();

    await user.click(
      within(tray).getByRole("button", {
        name: "Select Pick 23b · 1919 · 2 lei",
      }),
    );
    await user.click(within(tray).getByRole("button", { name: "Replace note" }));

    await waitFor(() =>
      expect(updateNode).toHaveBeenCalledWith(30, { note_id: 201 }),
    );
    expect(
      await screen.findByRole("button", { name: "Pick 23b · 1919 · 2 lei" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Replaced Pick 22a · 1917 · 1 leu with Pick 23b · 1919 · 2 lei.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() =>
      expect(updateNode).toHaveBeenCalledWith(30, { note_id: 101 }),
    );
  });

  test("Browse all notes closes the tray and opens the existing picker", async () => {
    const { tray, user } = await openTray();

    await user.click(
      within(tray).getByRole("button", { name: "Browse all notes…" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Pick 22a · 1917 · 1 leu" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", {
        name: "Replace “Pick 22a · 1917 · 1 leu” with a note",
      }),
    ).toBeInTheDocument();
  });

  test("the item menu keeps Replace with a note… and adds Siblings (3)…", async () => {
    const user = userEvent.setup();
    await openShowcase();

    await user.click(
      screen.getByRole("button", { name: "Actions for 1 leu Pick 22a 1917" }),
    );
    const menu = screen.getByRole("menu", {
      name: "Actions for 1 leu Pick 22a 1917",
    });

    expect(
      within(menu).getByRole("menuitem", { name: "Replace with a note…" }),
    ).toBeInTheDocument();
    await user.click(
      within(menu).getByRole("menuitem", { name: "Siblings (3)…" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Pick 22a · 1917 · 1 leu" }),
    ).toBeInTheDocument();
  });

  test("shows an inline error and retries the sibling fetch", async () => {
    getNoteSiblings.mockRejectedValueOnce(new Error("Siblings are offline."));
    await openShowcase();
    const user = userEvent.setup();

    await user.click(chip());

    const tray = await screen.findByRole("dialog", {
      name: "Pick 22a · 1917 · 1 leu",
    });
    expect(
      await within(tray).findByText("Siblings are offline."),
    ).toBeInTheDocument();

    await user.click(within(tray).getByRole("button", { name: "Try again" }));

    await waitForFirstSiblingFocus(tray);
    expect(getNoteSiblings).toHaveBeenCalledTimes(2);
  });

  test("all siblings already in the showcase leaves focus on the tray", async () => {
    getNoteSiblings.mockResolvedValue([IN_SHOWCASE_SIBLING]);

    const { tray } = await openTray();

    await waitFor(() =>
      expect(
        within(tray).getByRole("button", {
          name: "Pick 24c · 1920 · 5 lei is in this showcase",
        }),
      ).toBeDisabled(),
    );
    expect(tray).toHaveFocus();
  });

  test("Enter on the pinned note opens its preview and returns focus to it", async () => {
    const { tray, user } = await openTray();
    const currentPhoto = within(tray).getByRole("button", {
      name: "View images of the current note",
    });

    await waitForFirstSiblingFocus(tray);
    await user.keyboard("{ArrowLeft}");
    expect(currentPhoto).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("group", { name: "Image side" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close preview" }));

    await waitFor(() => expect(currentPhoto).toHaveFocus());
  });

  test("a sibling photo opens the image popover and returns focus on close", async () => {
    const { tray, user } = await openTray();
    const photo = within(tray).getByRole("button", {
      name: "View images of Pick 23b · 1919 · 2 lei",
    });

    await user.click(photo);

    expect(
      await screen.findByRole("dialog", { name: "2 lei, Pick 23b, 1919" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close preview" }));

    await waitFor(() => expect(photo).toHaveFocus());
  });

  test("Tab visits Item actions, then Show back, then the chip and ownership", async () => {
    await openShowcase();
    const user = userEvent.setup();
    const card = cardButton("Pick 22a · 1917 · 1 leu");

    act(() => card.focus());
    await user.tab();
    expect(
      screen.getByRole("button", { name: "Actions for 1 leu Pick 22a 1917" }),
    ).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Show back" })).toHaveFocus();

    await user.tab();
    expect(chip()).toHaveFocus();

    await user.tab();
    expect(
      screen.getByRole("button", {
        name: "Pick 22a · 1917 · 1 leu is owned. Mark as not owned",
      }),
    ).toHaveFocus();
  });

  test("Esc, Cancel, and the backdrop close the tray and return focus to the chip", async () => {
    const { tray, user } = await openTray();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(chip()).toHaveFocus());

    await user.click(chip());
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await waitFor(() => expect(chip()).toHaveFocus());

    await user.click(chip());
    fireEvent.click(document.querySelector(".showcase-tray-backdrop"));
    await waitFor(() => expect(chip()).toHaveFocus());

    expect(tray).not.toBeInTheDocument();
  });
});
