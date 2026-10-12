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

import {
  createNote,
  getNote,
  getNotes,
  getTags,
  reorderNotes,
  updateNote,
} from "../lib/api.js";

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

async function rowFor(denomination) {
  const cell = await screen.findByText(denomination);
  return cell.closest("tr");
}

function toolbarAddButton() {
  return screen.getByRole("button", { name: "Add note" });
}

function slideshowAddButton() {
  // The toolbar and the slideshow top bar both read "Add note"; the toolbar
  // button has no title, so the slideshow's own tooltip distinguishes it.
  return screen.getByTitle(/Add note/);
}

async function openEditorOn(user, denomination) {
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

async function openSlideshowOn(user, denomination) {
  await user.click((await screen.findByText(denomination)).closest("tr"));
  await waitFor(() => {
    expect(currentHash()).toContain("slideshow");
  });
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
  updateNote.mockImplementation(async (id, payload) => {
    const updated = {
      ...notesDb.find((entry) => entry.id === id),
      ...payload,
    };
    notesDb = notesDb.map((entry) => (entry.id === id ? updated : entry));
    return { note: updated };
  });
  reorderNotes.mockImplementation(async (order) => {
    notesDb = order.map((id) =>
      notesDb.find((entry) => entry.id === id),
    );
    return { notes: notesDb.map((entry) => ({ ...entry })) };
  });
});

describe("The counter in create mode", () => {
  test("adding a Note shows ? / N in place of a number", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());

    expect(await screen.findByText("? / 3")).toBeInTheDocument();
    expect(screen.queryByText("1 / 3")).not.toBeInTheDocument();
  });

  test("an arrow while adding opens the neighbouring Note for editing", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await screen.findByLabelText("Denomination");

    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    await waitFor(() => {
      expect(currentHash()).toContain("edit/1");
    });
  });

  test("a typed jump while adding opens that Note for editing", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await screen.findByLabelText("Denomination");

    await user.click(
      screen.getByRole("textbox", { name: "Current note position" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Current note position",
    });
    await user.type(input, "2{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
  });

  test("an empty view shows ? / 0 with no arrows", async () => {
    notesDb = [];
    const user = userEvent.setup();
    renderTable();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Add note" })).toBeTruthy();
    });
    await user.click(toolbarAddButton());

    expect(await screen.findByText("? / 0")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit previous note" }),
    ).not.toBeInTheDocument();
  });
});

describe("Adding from the Note slideshow", () => {
  test("Add note opens create mode over the slideshow with the current count", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "BBBB");

    await user.click(slideshowAddButton());

    expect(currentHash()).toContain("slideshow/2");
    expect(currentHash()).toContain("overlay=create");
    expect(await screen.findByText("? / 3")).toBeInTheDocument();
    // The slideshow stays rendered behind the editor. Its controls are inert
    // while the overlay is open (out of the tab order and the accessibility
    // tree), so pin the survival on a DOM attribute that outlives `inert`: the
    // slideshow's own "Previous note" tooltip, and the inert backdrop itself.
    const slideshowSurvivor = screen.getByTitle("Previous note (←)");
    expect(slideshowSurvivor).toBeInTheDocument();
    expect(slideshowSurvivor.closest("[inert]")).not.toBeNull();
    // The table behind is inert too, so a Tab cannot reach a row's Edit action
    // (or the toolbar) and silently drop the new Note.
    expect(
      screen.getByRole("button", { name: "Edit AAAA" }).closest("[inert]"),
    ).not.toBeNull();
  });

  test("the slideshow's shortcuts are inactive while the create overlay is open", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "BBBB");

    await user.keyboard("a");
    const field = await screen.findByLabelText("Denomination");
    expect(currentHash()).toContain("slideshow/2");
    expect(currentHash()).toContain("overlay=create");

    // Not in a field: if the slideshow still owned the keyboard, `e` would
    // switch to editing the note on screen and drop the new Note.
    act(() => {
      field.blur();
    });
    await user.keyboard("e");

    expect(currentHash()).toContain("overlay=create");
    expect(currentHash()).not.toContain("overlay=edit");
  });

  test("Add & close returns to the slideshow on the new Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "BBBB");

    await user.click(slideshowAddButton());
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/99");
    });
    expect(currentHash()).not.toContain("overlay");
    // The slideshow keeps the frozen list it was opened with: the context
    // (collection + filter/sort snapshot) survives the save-and-return.
    expect(currentHash()).toContain("collection=1");
    // The new Note landed immediately before BBBB (id 2).
    expect(reorderNotes).toHaveBeenCalledWith([1, 99, 2, 3], 1);
  });

  test("the slideshow's own counter jumps to a typed Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "AAAA");

    await user.click(
      screen.getByRole("textbox", { name: "Note position" }),
    );
    const input = screen.getByRole("textbox", { name: "Note position" });
    await user.type(input, "3{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3");
    });
  });

  test("the image preview's counter jumps to a typed page", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "AAAA");

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    await user.click(
      screen.getByRole("textbox", { name: "Image position" }),
    );
    const input = screen.getByRole("textbox", { name: "Image position" });
    await user.type(input, "4{Enter}");

    // The 4th page in a front/back-per-note sequence is the second note's back.
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2/preview/back");
    });
  });

  test("a starts adding and e opens the note on screen", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "BBBB");

    await user.keyboard("a");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
      expect(currentHash()).toContain("overlay=create");
    });

    // The create form focuses Denomination, so the first Escape only blurs
    // the field; the second dismisses the overlay.
    act(() => {
      screen.getByLabelText("Denomination").blur();
    });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(currentHash()).not.toContain("overlay");
    });

    await user.keyboard("e");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
      expect(currentHash()).toContain("overlay=edit");
    });
  });

  test("Add stays in the editor over the slideshow", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "BBBB");

    await user.click(slideshowAddButton());
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/99");
      expect(currentHash()).toContain("overlay=edit");
    });
    expect(await screen.findByLabelText("Denomination")).toHaveValue("NEW");
  });
});

describe("Leaving a changed Note editor", () => {
  test("navigating away from a changed Note asks first", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");

    await user.type(field, "!");
    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Discard changes?" }),
    ).toBeInTheDocument();

    // Keep editing leaves the editor exactly where it was.
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(currentHash()).toContain("edit/1");
    expect(await screen.findByLabelText("Denomination")).toHaveValue("AAAA!");

    // Discard completes the navigation.
    await user.click(screen.getByRole("button", { name: "Edit next note" }));
    const secondDialog = await screen.findByRole("dialog");
    await user.click(
      within(secondDialog).getByRole("button", { name: "Discard" }),
    );
    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
  });

  test("an unchanged Note navigates with no prompt", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "AAAA");

    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("stepping through unchanged notes never prompts", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "AAAA");

    await user.click(screen.getByRole("button", { name: "Edit next note" }));
    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });

    // Step again while the next Note is still loading: no false dirty flag.
    await user.click(screen.getByRole("button", { name: "Edit next note" }));
    await waitFor(() => {
      expect(currentHash()).toContain("edit/3");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a typed jump is gated the same way", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");
    await user.type(field, "!");

    await user.click(
      screen.getByRole("textbox", { name: "Current note position" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Current note position",
    });
    await user.type(input, "2{Enter}");

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
  });

  test("a keyboard arrow is gated the same way", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");
    await user.type(field, "!");

    act(() => {
      field.blur();
    });
    await user.keyboard("{ArrowRight}");

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
    expect(currentHash()).toContain("edit/1");

    await user.keyboard("{ArrowRight}");
    const secondDialog = await screen.findByRole("dialog");
    await user.click(
      within(secondDialog).getByRole("button", { name: "Discard" }),
    );
    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
  });

  test("an unchanged typed jump navigates with no prompt", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.click(
      screen.getByRole("textbox", { name: "Current note position" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Current note position",
    });
    await user.type(input, "1{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("edit/1");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("an unchanged Note closes with no prompt from Close or Escape", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "AAAA");

    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openEditorOn(user, "AAAA");
    const field = await screen.findByLabelText("Denomination");
    act(() => {
      field.blur();
    });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a changed new Note names what will be lost", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Discard new note?" }),
    ).toBeInTheDocument();
  });

  test("changing a value back to what it was does not arm the prompt", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");

    await user.type(field, "!");
    await user.clear(field);
    await user.type(field, "AAAA");
    await user.click(screen.getByRole("button", { name: "Edit next note" }));

    await waitFor(() => {
      expect(currentHash()).toContain("edit/2");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Close confirms, and Escape dismisses the confirmation only", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");
    await user.type(field, "!");

    act(() => {
      field.blur();
    });
    await user.click(screen.getByRole("button", { name: "Close" }));

    const dialog = await screen.findByRole("dialog");
    // Escape closes the confirmation without discarding anything.
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(currentHash()).toContain("edit/1");

    await user.click(screen.getByRole("button", { name: "Close" }));
    const secondDialog = await screen.findByRole("dialog");
    await user.click(
      within(secondDialog).getByRole("button", { name: "Discard" }),
    );

    await waitFor(() => {
      expect(currentHash()).not.toContain("edit");
    });
  });

  test("saving never prompts", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");
    await user.type(field, "!");

    await user.click(screen.getByRole("button", { name: "Save & close" }));

    await waitFor(() => {
      expect(currentHash()).not.toContain("edit");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Escape on a changed Note asks before closing", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");
    await user.type(field, "!");

    act(() => {
      field.blur();
    });
    await user.keyboard("{Escape}");

    expect(
      within(await screen.findByRole("dialog")).getByRole("heading", {
        name: "Discard changes?",
      }),
    ).toBeInTheDocument();
    expect(currentHash()).toContain("edit/1");
  });
});

describe("The counter's editable number in the editor", () => {
  test("arrows move the caret instead of changing notes", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.click(
      screen.getByRole("textbox", { name: "Current note position" }),
    );
    const input = screen.getByRole("textbox", {
      name: "Current note position",
    });
    await user.type(input, "1");
    await user.keyboard("{ArrowLeft}");

    expect(currentHash()).toContain("edit/2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Two save actions", () => {
  test("Add stays in the editor on the new Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(currentHash()).toContain("edit/99");
    });
    expect(await screen.findByLabelText("Denomination")).toHaveValue("NEW");
  });

  test("Add & close returns to the table on the new Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(toolbarAddButton());
    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    const newRow = await rowFor("NEW");
    await waitFor(() => {
      expect(newRow).toHaveFocus();
    });
    expect(currentHash()).not.toContain("edit");
  });

  test("Save keeps the editor open on the edited Note", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");

    await user.type(field, "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalled();
    });
    expect(currentHash()).toContain("edit/1");
    expect(await screen.findByLabelText("Denomination")).toHaveValue("AAAA!");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the two save actions have distinct accessible names", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "AAAA");

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save & close" })).toBeInTheDocument();
  });

  test("Save keeps the editor open over the slideshow on the edited Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "AAAA");
    await user.click(screen.getByRole("button", { name: "Edit note" }));
    const field = await screen.findByLabelText("Denomination");

    await user.type(field, "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
      expect(currentHash()).toContain("overlay=edit");
    });
    expect(await screen.findByLabelText("Denomination")).toHaveValue("AAAA!");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Save & close returns to the slideshow on the edited Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openSlideshowOn(user, "AAAA");
    await user.click(screen.getByRole("button", { name: "Edit note" }));
    const field = await screen.findByLabelText("Denomination");

    await user.type(field, "!");
    await user.click(screen.getByRole("button", { name: "Save & close" }));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
    expect(currentHash()).not.toContain("overlay");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Ctrl+S keeps the editor open on the edited Note", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");

    await user.type(field, "!");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalled();
    });
    expect(currentHash()).toContain("edit/1");
    expect(await screen.findByLabelText("Denomination")).toHaveValue("AAAA!");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Ctrl+Shift+S closes the editor on the edited Note", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "AAAA");

    await user.type(field, "!");
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");

    await waitFor(() => {
      expect(currentHash()).not.toContain("edit");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("The editor's collection actions", () => {
  test("Save & close is the primary action; every action shows its shortcut", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "AAAA");

    const save = screen.getByRole("button", { name: "Save" });
    const saveAndClose = screen.getByRole("button", { name: "Save & close" });

    expect(saveAndClose).toHaveClass("button-primary");
    expect(save).not.toHaveClass("button-primary");

    expect(save).toHaveAttribute("data-shortcut", "Ctrl+S");
    expect(saveAndClose).toHaveAttribute("data-shortcut", "Ctrl+Shift+S");
    expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute(
      "data-shortcut",
      "Esc",
    );
    expect(screen.getByRole("button", { name: "Add before" })).toHaveAttribute(
      "data-shortcut",
      "Ctrl+A",
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute(
      "data-shortcut",
      "Ctrl+D",
    );
  });

  test("Add before opens create mode ahead of the edited note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.click(screen.getByRole("button", { name: "Add before" }));

    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    // The new Note landed immediately before BBBB (id 2).
    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 99, 2, 3], 1);
    });
  });

  test("Delete removes the edited note and closes the editor", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(currentHash()).not.toContain("edit");
    expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
  });

  test("cancelling Delete keeps the note and the editor", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("BBBB")).toBeInTheDocument();
    expect(currentHash()).toContain("edit/2");
    expect(screen.getByLabelText("Denomination")).toBeInTheDocument();
  });

  test("Ctrl+A opens create mode ahead of the edited note", async () => {
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "BBBB");

    // Ctrl+A is the add-before shortcut only when no field owns the key.
    act(() => {
      field.blur();
    });
    await user.keyboard("{Control>}a{/Control}");

    await user.type(await screen.findByLabelText("Denomination"), "NEW");
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([1, 99, 2, 3], 1);
    });
  });

  test("Ctrl+D deletes the edited note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.keyboard("{Control>}d{/Control}");

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(currentHash()).not.toContain("edit");
  });

  test("Ctrl+A in a field keeps select-all and does not add a note", async () => {
    const user = userEvent.setup();
    renderTable();
    await openEditorOn(user, "BBBB");

    await user.keyboard("{Control>}a{/Control}");

    // Still editing BBBB, not creating a note before it.
    expect(currentHash()).toContain("edit/2");
    expect(screen.getByLabelText("Denomination")).toBeInTheDocument();
  });

  test("the save shortcut is ignored while the delete dialog is open", async () => {
    updateNote.mockClear();
    const user = userEvent.setup();
    renderTable();
    const field = await openEditorOn(user, "BBBB");

    await user.type(field, "!");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");

    await user.keyboard("{Control>}s{/Control}");

    expect(updateNote).not.toHaveBeenCalled();
    expect(currentHash()).toContain("edit/2");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await screen.findByLabelText("Denomination")).toHaveValue("BBBB!");
  });
});

describe("Deleting the Note being edited from the slideshow", () => {
  async function deleteEditingFromSlideshow(user, denomination) {
    await openSlideshowOn(user, denomination);
    await user.click(screen.getByRole("button", { name: "Edit note" }));
    await screen.findByLabelText("Denomination");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  }

  test("moves to the next note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await deleteEditingFromSlideshow(user, "BBBB");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3");
    });
    expect(screen.queryByLabelText("Denomination")).not.toBeInTheDocument();
  });

  test("moves to the previous note when it was the last", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await deleteEditingFromSlideshow(user, "CCCC");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
    });
  });

  test("moves to the next note when it was the first", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await deleteEditingFromSlideshow(user, "AAAA");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
    });
  });

  test("returns to the Table when it was the only note", async () => {
    notesDb = [note(1, "AAAA")];
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await deleteEditingFromSlideshow(user, "AAAA");

    await waitFor(() => {
      expect(currentHash()).not.toContain("slideshow");
    });
    expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
  });
});

describe("The a shortcut in the Table", () => {
  test("with no row focused it opens the create form", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.keyboard("a");

    await waitFor(() => {
      expect(currentHash()).toContain("#new");
    });
    expect(await screen.findByLabelText("Denomination")).toBeInTheDocument();
  });

  test("with a row focused it inserts before that row", async () => {
    const user = userEvent.setup();
    renderTable();
    const row = await rowFor("BBBB");
    row.focus();

    await user.keyboard("a");

    await waitFor(() => {
      expect(currentHash()).toContain("before=2");
    });
  });

  test("with focus inside a row's control it still inserts before that row", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    screen.getByRole("button", { name: "Insert note before BBBB" }).focus();

    await user.keyboard("a");

    await waitFor(() => {
      expect(currentHash()).toContain("before=2");
    });
  });
});

describe("Shortcut tooltips", () => {
  test("the table's note buttons and Add note expose their shortcuts", async () => {
    renderTable();
    await screen.findByText("AAAA");

    expect(screen.getByRole("button", { name: "Copy AAAA" })).toHaveAttribute(
      "data-shortcut",
      "c",
    );
    expect(
      screen.getByRole("button", { name: "Insert note before AAAA" }),
    ).toHaveAttribute("data-shortcut", "a");
    expect(screen.getByRole("button", { name: "Edit AAAA" })).toHaveAttribute(
      "data-shortcut",
      "e",
    );
    expect(screen.getByRole("button", { name: "Delete AAAA" })).toHaveAttribute(
      "data-shortcut",
      "d",
    );
    expect(toolbarAddButton()).toHaveAttribute("data-shortcut", "a");
  });
});

describe("Destructive confirmations use the app dialog", () => {
  test("cancelling a delete keeps the Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    await user.click(screen.getByRole("button", { name: "Delete BBBB" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("BBBB")).toBeInTheDocument();
  });

  test("confirming a delete removes the Note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    await user.click(screen.getByRole("button", { name: "Delete BBBB" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete BBBB?" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
  });
});
