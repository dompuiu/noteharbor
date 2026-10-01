import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getOperationStatus: vi.fn(),
  getScrapeStatus: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  startScrape: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [
      { id: 1, is_default: 1, name: "Test" },
      { id: 2, is_default: 0, name: "Archive" },
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
  getOperationStatus,
  getScrapeStatus,
  getTags,
  moveNote,
  reorderNotes,
  updateNote,
} from "../lib/api.js";

// The collection the table reads from. The CRUD mocks below mutate it so a
// post-save refetch (the create flow reorders the note into place) sees the
// same collection the table is about to show.
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
    scrape_status: "idle",
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
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[
          { id: 1, is_default: 1, name: "Test" },
          { id: 2, is_default: 0, name: "Archive" },
        ]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>,
  );
}

async function rowFor(denomination) {
  const cell = await screen.findByText(denomination);
  return cell.closest("tr");
}

function toolbarAddButton() {
  return screen.getByRole("button", { name: "Add note" });
}

function editorSubmitButton() {
  return screen.getByRole("button", { name: "Add" });
}

async function confirmDelete(user) {
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
}

beforeEach(() => {
  window.localStorage.clear();
  notesDb = [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")];

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

  getNotes.mockImplementation(async (collectionId) => ({
    // The destination collection (2) is empty, so the move form does not
    // demand a reference note to position against.
    notes:
      collectionId === 2
        ? []
        : notesDb.map((entry) => ({ ...entry })),
  }));
  getNote.mockImplementation(async (id) => ({
    note: { ...notesDb.find((entry) => entry.id === id) },
  }));
  getTags.mockResolvedValue({ tags: [] });
  getScrapeStatus.mockResolvedValue({ status: "idle", items: [] });
  getOperationStatus.mockResolvedValue({
    currentOperation: "idle",
    isBusy: false,
  });
  deleteNote.mockImplementation(async (id) => {
    notesDb = notesDb.filter((entry) => entry.id !== id);
  });
  createNote.mockImplementation(async (payload) => {
    const created = note(99, payload.denomination || "NEW");
    notesDb = [...notesDb, created];
    return { note: created };
  });
  updateNote.mockImplementation(async (id, payload) => {
    const updated = {
      ...notesDb.find((entry) => entry.id === id),
      ...payload,
    };
    notesDb = notesDb.map((entry) => (entry.id === id ? updated : entry));
    return { note: updated };
  });
  reorderNotes.mockImplementation(async (order) => {
    notesDb = order.map((id) => notesDb.find((entry) => entry.id === id));
    return { notes: notesDb.map((entry) => ({ ...entry })) };
  });
  moveNote.mockImplementation(async (id) => ({
    note: { ...notesDb.find((entry) => entry.id === id) },
  }));
});

describe("Delete keeps the cursor on the table", () => {
  test("deleting a row moves focus to the row that replaces it", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("button", { name: "Delete BBBB" }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    const replacement = await rowFor("CCCC");
    await waitFor(() => {
      expect(replacement).toHaveFocus();
    });
    expect(replacement).toHaveClass("table-row-link--active");
  });

  test("deleting the last row moves focus to the new last row", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("button", { name: "Delete CCCC" }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(screen.queryByText("CCCC")).not.toBeInTheDocument();
    });

    const replacement = await rowFor("BBBB");
    await waitFor(() => {
      expect(replacement).toHaveFocus();
    });
  });

  test("bulk delete moves focus to the row in the first deleted slot", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("checkbox", { name: "Select AAAA" }));
    await user.click(screen.getByRole("checkbox", { name: "Select BBBB" }));
    await user.selectOptions(screen.getByLabelText("Bulk action"), "delete");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    const replacement = await rowFor("CCCC");
    await waitFor(() => {
      expect(replacement).toHaveFocus();
    });
  });

  test("deleting the only row keeps focus on the table anchor", async () => {
    notesDb = [note(1, "AAAA")];
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");

    await user.click(screen.getByRole("button", { name: "Delete AAAA" }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });
    const anchor = container.querySelector(".table-focus-anchor");
    await waitFor(() => {
      expect(anchor).toHaveFocus();
    });
  });
});

describe("The note editor hands the cursor back", () => {
  test("saving a new note focuses its row", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await waitFor(() => {
      expect(editorSubmitButton()).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    const newRow = await rowFor("NEW");
    await waitFor(() => {
      expect(newRow).toHaveFocus();
    });
    expect(newRow).toHaveClass("table-row-link--active");
  });

  test("closing the add form returns focus to the remembered row", async () => {
    const user = userEvent.setup();
    renderTable();

    const row = await rowFor("BBBB");
    await act(async () => {
      row.focus();
    });
    expect(row).toHaveFocus();

    await user.click(toolbarAddButton());
    await user.click(await screen.findByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(row).toHaveFocus();
    });
    expect(row).toHaveClass("table-row-link--active");
  });

  test("closing the add form with no remembered row focuses the first row", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await user.click(await screen.findByRole("button", { name: "Close" }));

    const firstRow = await rowFor("AAAA");
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
  });

  test("closing the add form on an empty table focuses the table anchor", async () => {
    notesDb = [];
    const user = userEvent.setup();
    const { container } = renderTable();

    await waitFor(() => {
      expect(container.querySelectorAll("tr.table-row-link")).toHaveLength(0);
    });

    await user.click(toolbarAddButton());
    await user.click(await screen.findByRole("button", { name: "Close" }));

    const anchor = container.querySelector(".table-focus-anchor");
    await waitFor(() => {
      expect(anchor).toHaveFocus();
    });
  });

  test("a save that leaves the note out of view is a no-op", async () => {
    notesDb = [note(1, "AAAA"), note(2, "BBBB")];
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("button", { name: "Edit AAAA" }));

    // Move the edited note away while other rows remain: the target is gone
    // but the view is not empty, so the cursor must not jump to another row.
    const collectionSelect = container.querySelector(
      ".edit-note-overlay select",
    );
    await user.selectOptions(collectionSelect, "2");
    await user.click(
      await screen.findByRole("button", { name: "Save & close" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });

    const remaining = await rowFor("BBBB");
    expect(remaining).not.toHaveFocus();
    expect(remaining).not.toHaveClass("table-row-link--active");
  });

  test("a save that empties the view focuses the table anchor", async () => {
    notesDb = [note(1, "AAAA")];
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("AAAA");
    await user.click(screen.getByRole("button", { name: "Edit AAAA" }));

    // Move the only note to the other collection: the save takes the last
    // visible row with it, leaving nothing to focus.
    const collectionSelect = container.querySelector(
      ".edit-note-overlay select",
    );
    await user.selectOptions(collectionSelect, "2");
    await user.click(
      await screen.findByRole("button", { name: "Save & close" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });

    const anchor = container.querySelector(".table-focus-anchor");
    await waitFor(() => {
      expect(anchor).toHaveFocus();
    });
  });

  test("closing the edit form focuses the note being edited", async () => {
    const user = userEvent.setup();
    renderTable();

    const row = await rowFor("BBBB");
    await act(async () => {
      row.focus();
    });
    await user.keyboard("e");

    await user.click(await screen.findByRole("button", { name: "Close" }));

    const restored = await rowFor("BBBB");
    await waitFor(() => {
      expect(restored).toHaveFocus();
    });
  });

  test("closing after stepping to the next note focuses that note", async () => {
    const user = userEvent.setup();
    renderTable();

    const row = await rowFor("AAAA");
    await act(async () => {
      row.focus();
    });
    await user.keyboard("e");

    await user.click(
      await screen.findByRole("button", { name: "Edit next note" }),
    );
    await user.click(await screen.findByRole("button", { name: "Close" }));

    const restored = await rowFor("BBBB");
    await waitFor(() => {
      expect(restored).toHaveFocus();
    });
  });

  test("saving an edit focuses the edited note", async () => {
    const user = userEvent.setup();
    renderTable();

    const row = await rowFor("BBBB");
    await act(async () => {
      row.focus();
    });
    await user.keyboard("e");

    await user.click(
      await screen.findByRole("button", { name: "Save & close" }),
    );

    const restored = await rowFor("BBBB");
    await waitFor(() => {
      expect(restored).toHaveFocus();
    });
  });

  test("a background refresh does not move focus", async () => {
    // Polling is the one path that swaps the note list without a user
    // action; it must leave the keyboard cursor where the user put it.
    getOperationStatus.mockResolvedValue({
      currentOperation: "scraping",
      isBusy: true,
    });
    getScrapeStatus.mockResolvedValue({ status: "running", items: [] });

    const user = userEvent.setup();
    renderTable();

    const row = await rowFor("BBBB");
    await act(async () => {
      row.focus();
    });
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    // Let the 2s poll tick and replace the list under the focused row.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2200));
    });

    expect(row).toHaveFocus();
    expect(row).toHaveClass("table-row-link--active");
  });
});

describe("Note editor Escape", () => {
  async function openEditorOn(user, denomination = "AAAA") {
    renderTable();
    await screen.findByText(denomination);
    await user.click(
      screen.getByRole("button", { name: `Edit ${denomination}` }),
    );

    const field = await screen.findByLabelText("Denomination");
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
    return field;
  }

  test("Escape blurs a focused field before it closes the editor", async () => {
    const user = userEvent.setup();
    const field = await openEditorOn(user);

    await user.keyboard("{Escape}");

    expect(field).not.toHaveFocus();
    expect(screen.getByLabelText("Denomination")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
    });
  });

  test("Escape closes the editor in one press when no field is focused", async () => {
    const user = userEvent.setup();
    const field = await openEditorOn(user);

    act(() => {
      field.blur();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
    });
  });
});
