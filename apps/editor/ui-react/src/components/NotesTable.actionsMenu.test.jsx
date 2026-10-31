import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [{ id: 1, is_default: 1, name: "Test" }],
  }),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 43,
        start: index * 43,
        end: (index + 1) * 43,
      })),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { deleteNote, getNote, getNotes, getTags } from "../lib/api.js";

let notesDb;

function note(id, denomination, overrides = {}) {
  return {
    id,
    display_order: id,
    denomination,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...overrides,
  };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-hash">{location.hash}</output>;
}

function renderTable() {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <NotesTable
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

function currentHash() {
  return screen.getByTestId("route-hash").textContent;
}

function actionsButton(denomination) {
  return screen.getByRole("button", {
    name: `Actions for ${denomination}`,
  });
}

async function openMenu(user, denomination) {
  await screen.findByText(denomination);
  await user.click(actionsButton(denomination));
  return screen.findByRole("menu", {
    name: `Actions for ${denomination}`,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 600,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  notesDb = [
    note(1, "AAAA", {
      catalog_number: "Fr. 1",
      url: "https://example.test/aaaa",
    }),
    note(2, "BBBB"),
    note(3, "CCCC"),
  ];
  getNotes.mockImplementation(async () => ({
    notes: notesDb.map((entry) => ({ ...entry })),
  }));
  getNote.mockImplementation(async (id) => ({
    note: { ...notesDb.find((entry) => entry.id === id) },
  }));
  deleteNote.mockImplementation(async (id) => {
    notesDb = notesDb.filter((entry) => entry.id !== id);
  });
  getTags.mockResolvedValue({ tags: [] });
});

describe("Row actions menu", () => {
  test("each row exposes one actions button and no inline action buttons", async () => {
    renderTable();
    await screen.findByText("AAAA");

    expect(
      screen.getAllByRole("button", { name: /^Actions for / }),
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    ).toHaveAttribute("aria-haspopup", "menu");
    expect(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    ).toHaveAttribute("aria-expanded", "false");

    expect(
      screen.queryByRole("button", { name: "Copy AAAA" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Insert note before AAAA" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit AAAA" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete AAAA" }),
    ).not.toBeInTheDocument();
  });

  test("lists the row actions in order and marks the button expanded", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "AAAA");

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Open",
      "Edit",
      "Copy details",
      "Insert note below",
      "Open source",
      "Delete",
    ]);
    expect(actionsButton("AAAA")).toHaveAttribute("aria-expanded", "true");
    // Opening the menu is not a row activation.
    expect(currentHash()).not.toContain("slideshow");
  });

  test("Open opens the note slideshow", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "AAAA");

    await user.click(within(menu).getByRole("menuitem", { name: "Open" }));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  });

  test("Edit opens the note editor", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "BBBB");

    await user.click(within(menu).getByRole("menuitem", { name: "Edit" }));

    expect(await screen.findByLabelText("Denomination")).toBeInTheDocument();
    expect(currentHash()).toContain("edit/2");
  });

  test("Copy details copies the note's fields", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderTable();
    const menu = await openMenu(user, "AAAA");

    await user.click(
      within(menu).getByRole("menuitem", { name: "Copy details" }),
    );

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0][0].split("\t")).toEqual([
      "AAAA",
      "",
      "Fr. 1",
      "",
      "",
      "",
      "",
      "https://example.test/aaaa",
      "",
      "",
    ]);
  });

  test("Insert note below positions the new note after this one", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "AAAA");

    await user.click(
      within(menu).getByRole("menuitem", { name: "Insert note below" }),
    );

    await waitFor(() => {
      expect(currentHash()).toContain("before=2");
    });
  });

  test("Insert note below on the last row creates at the end", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "CCCC");

    await user.click(
      within(menu).getByRole("menuitem", { name: "Insert note below" }),
    );

    await waitFor(() => {
      expect(currentHash()).toContain("#new");
    });
    expect(currentHash()).not.toContain("before=");
  });

  test("Delete still asks for confirmation before removing the note", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "CCCC");

    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete CCCC?" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("CCCC")).not.toBeInTheDocument();
    });
  });

  test("Open source is offered only when the note has a URL", async () => {
    const user = userEvent.setup();
    renderTable();

    const withUrl = await openMenu(user, "AAAA");
    const source = within(withUrl).getByRole("menuitem", {
      name: "Open source",
    });
    expect(source).toHaveAttribute("href", "https://example.test/aaaa");
    expect(source).toHaveAttribute("target", "_blank");

    await user.keyboard("{Escape}");

    const withoutUrl = await openMenu(user, "BBBB");
    expect(
      within(withoutUrl).queryByRole("menuitem", { name: "Open source" }),
    ).not.toBeInTheDocument();
  });

  test("Escape closes the menu and returns focus to the actions button", async () => {
    const user = userEvent.setup();
    renderTable();
    const menu = await openMenu(user, "AAAA");

    expect(
      within(menu).getByRole("menuitem", { name: "Open" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(actionsButton("AAAA")).toHaveFocus();
    expect(actionsButton("AAAA")).toHaveAttribute("aria-expanded", "false");
  });

  test("arrow keys move between menu items and Enter activates one", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    actionsButton("BBBB").focus();
    await user.keyboard("{Enter}");

    const menu = await screen.findByRole("menu", {
      name: "Actions for BBBB",
    });
    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{End}");
    expect(items[items.length - 1]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Denomination")).toBeInTheDocument();
  });

  test("Enter on the actions button opens the menu instead of the slideshow", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    actionsButton("AAAA").focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("menu", { name: "Actions for AAAA" }),
    ).toBeInTheDocument();
    expect(currentHash()).not.toContain("slideshow");
  });

  test("arrow keys from the actions button move to the next or previous row", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    actionsButton("BBBB").focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByText("CCCC").closest("tr")).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    actionsButton("BBBB").focus();
    await user.keyboard("{ArrowUp}");

    expect(screen.getByText("AAAA").closest("tr")).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("clicking outside or scrolling the table closes the menu", async () => {
    const user = userEvent.setup();
    renderTable();

    await openMenu(user, "AAAA");
    await user.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await openMenu(user, "AAAA");
    window.dispatchEvent(new Event("scroll"));
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
