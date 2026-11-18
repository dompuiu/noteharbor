import { MemoryRouter } from "react-router-dom";
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
  moveNotes: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [
      { id: 1, is_default: 1, name: "Default", note_count: 3 },
      { id: 2, is_default: 0, name: "Archive", note_count: 0 },
    ],
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

import {
  createNote,
  deleteNote,
  getNote,
  getNotes,
  getTags,
  moveNotes,
  reorderNotes,
} from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Default", note_count: 3 },
  { id: 2, is_default: 0, name: "Archive", note_count: 0 },
];

let notesDb;

function note(id, denomination) {
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
  };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTable(onNoteCountChange = vi.fn()) {
  const view = render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <NotesTable
        collection={collections[0]}
        collectionId={1}
        collections={collections}
        collectionsError=""
        loadingCollections={false}
        onNoteCountChange={onNoteCountChange}
      />
    </MemoryRouter>,
  );

  return { ...view, onNoteCountChange };
}

async function openRowMenu(user, denomination) {
  await screen.findByText(denomination);
  await user.click(
    screen.getByRole("button", { name: `Actions for ${denomination}` }),
  );
  return screen.findByRole("menu", { name: `Actions for ${denomination}` });
}

beforeEach(() => {
  vi.clearAllMocks();
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

  notesDb = [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")];
  getNotes.mockImplementation(async () => ({
    notes: notesDb.map((entry) => ({ ...entry })),
  }));
  getNote.mockImplementation(async (id) => ({
    note: { ...notesDb.find((entry) => entry.id === id) },
  }));
  getTags.mockResolvedValue({ tags: [] });
  createNote.mockImplementation(async (payload) => {
    const created = note(99, payload.denomination || "NEW");
    notesDb = [...notesDb, created];
    return { note: created };
  });
  deleteNote.mockImplementation(async (id) => {
    notesDb = notesDb.filter((entry) => entry.id !== id);
  });
  moveNotes.mockImplementation(async (ids) => {
    const moved = notesDb.filter((entry) => ids.includes(entry.id));
    notesDb = notesDb.filter((entry) => !ids.includes(entry.id));
    return moved;
  });
  reorderNotes.mockImplementation(async (order) => {
    notesDb = order.map((id) => notesDb.find((entry) => entry.id === id));
    return { notes: notesDb.map((entry) => ({ ...entry })) };
  });
});

describe("The collection badge follows the table's notes", () => {
  test("a loaded list reports its size", async () => {
    const { onNoteCountChange } = renderTable();

    await screen.findByText("AAAA");

    expect(onNoteCountChange).toHaveBeenCalledWith(1, 3);
  });

  test("a new note raises the reported count", async () => {
    const user = userEvent.setup();
    const { onNoteCountChange } = renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("button", { name: "Add note" }));
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    await waitFor(() => {
      expect(onNoteCountChange).toHaveBeenLastCalledWith(1, 4);
    });
  });

  test("a move raises the destination and lowers this collection", async () => {
    const user = userEvent.setup();
    const { onNoteCountChange } = renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("button", { name: "Move to…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move note" });
    // Staying on this table is the path where the destination's badge has no
    // table load of its own to learn the note from.
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Show Archive after moving",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await waitFor(() => {
      expect(onNoteCountChange).toHaveBeenCalledWith(2, 1);
      expect(onNoteCountChange).toHaveBeenLastCalledWith(1, 2);
    });
  });

  test("a deleted note lowers the reported count", async () => {
    const user = userEvent.setup();
    const { onNoteCountChange } = renderTable();
    const menu = await openRowMenu(user, "CCCC");

    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(onNoteCountChange).toHaveBeenLastCalledWith(1, 2);
    });
  });
});
