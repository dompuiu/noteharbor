import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { chooseSelectOption } from "../test/selectField.js";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
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
    collections: [
      { id: 1, name: "Test" },
      { id: 2, name: "Second" },
    ],
  }),
}));

import { createNote, getNote, getNotes, getTags, reorderNotes } from "../lib/api.js";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function firstNotePayload() {
  return {
    id: 1,
    denomination: "FIRSTNOTE",
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    watermark: "",
    serial: "",
    url: "",
    notes: "",
    tags: [],
    images: [],
    updated_at: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getNote.mockResolvedValue({ note: firstNotePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
});

describe("Note editor create mode over the table", () => {
  test("an explicit null noteId stays a blank form under a collection route", async () => {
    // The table overlay passes noteId={null} for create while the URL holds
    // the collection id (/catalog/collections/:id/view). The form must not
    // mistake that route param for a note id and load the first note.
    render(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <Routes>
          <Route
            path="/catalog/collections/:id/view"
            element={
              <NoteEditForm noteId={null} overlay selectedCollectionId={1} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByLabelText("Denomination");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Add note" }),
    ).toBeInTheDocument();
    expect(getNote).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Denomination")).toHaveValue("");
    // The destination Collection is part of creating a note too, not just
    // editing one.
    expect(
      screen.getByRole("combobox", { name: "Collection" }),
    ).toHaveValue("Test");
  });

  test("an explicit note id still edits that note under a collection route", async () => {
    render(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <Routes>
          <Route
            path="/catalog/collections/:id/view"
            element={
              <NoteEditForm noteId={1} overlay selectedCollectionId={1} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Denomination")).toHaveValue(
      "FIRSTNOTE",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "FIRSTNOTE" }),
    ).toBeInTheDocument();
    expect(getNote).toHaveBeenCalledWith(1, 1);
  });

  test("captions the Display title with the Collection", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <Routes>
          <Route
            path="/catalog/collections/:id/view"
            element={
              <NoteEditForm noteId={null} overlay selectedCollectionId={1} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByLabelText("Denomination");

    const eyebrow = container.querySelector(
      ".note-editor-title .collection-eyebrow",
    );
    expect(eyebrow).toHaveTextContent("Test");
    const title = screen.getByRole("heading", { level: 1, name: "Add note" });
    expect(
      eyebrow.compareDocumentPosition(title) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("an existing note without a denomination titles as Untitled note", async () => {
    getNote.mockResolvedValue({
      note: { ...firstNotePayload(), denomination: "" },
    });

    render(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <Routes>
          <Route
            path="/catalog/collections/:id/view"
            element={
              <NoteEditForm noteId={1} overlay selectedCollectionId={1} />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Denomination")).toHaveValue("");
    expect(
      screen.getByRole("heading", { level: 1, name: "Untitled note" }),
    ).toBeInTheDocument();
  });

  test("no noteId prop still resolves the standalone note route", async () => {
    render(
      <MemoryRouter initialEntries={["/catalog/notes/1/edit"]}>
        <Routes>
          <Route
            path="/catalog/notes/:id/edit"
            element={<NoteEditForm selectedCollectionId={1} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText("Denomination")).toHaveValue(
      "FIRSTNOTE",
    );
    expect(getNote).toHaveBeenCalledWith("1", 1);
  });

  test("a new note with no collection waits for one before it saves", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({
      notes: [{ ...firstNotePayload(), id: 9, display_order: 1 }],
    });

    render(
      <MemoryRouter initialEntries={["/catalog/notes/new/edit"]}>
        <Routes>
          <Route
            path="/catalog/notes/new/edit"
            element={<NoteEditForm noteId={null} selectedCollectionId={null} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByLabelText("Denomination");
    expect(
      screen.getByRole("combobox", { name: "Collection" }),
    ).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add & close" })).toBeDisabled();
    expect(
      screen.queryByRole("combobox", { name: "Position in collection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Select a collection to set the note’s position and save."),
    ).toBeInTheDocument();
    expect(getNotes).not.toHaveBeenCalled();
    expect(getTags).not.toHaveBeenCalled();

    await chooseSelectOption(user, "Collection", "Second");

    await waitFor(() => {
      expect(getNotes).toHaveBeenCalledWith(2);
    });
    expect(
      await screen.findByRole("combobox", { name: "Position in collection" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add & close" })).toBeEnabled();
  });

  test("submitting without a collection reports what is missing", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/catalog/notes/new/edit"]}>
        <Routes>
          <Route
            path="/catalog/notes/new/edit"
            element={<NoteEditForm noteId={null} selectedCollectionId={null} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByLabelText("Denomination");
    fireEvent.submit(container.querySelector("#edit-note-form"));

    expect(
      await screen.findByText("Select a collection before saving the note."),
    ).toBeInTheDocument();
    expect(createNote).not.toHaveBeenCalled();
  });

  test("a collection-less new note can stay on All notes after saving", async () => {
    const user = userEvent.setup();
    const savedNote = {
      ...firstNotePayload(),
      id: 9,
      collection_id: 2,
      display_order: 1,
    };
    getNotes.mockResolvedValue({
      notes: [{ ...firstNotePayload(), id: 8, display_order: 1 }],
    });
    createNote.mockResolvedValue({ note: savedNote });
    reorderNotes.mockResolvedValue({ notes: [savedNote] });

    render(
      <MemoryRouter initialEntries={["/catalog/notes/new/edit"]}>
        <LocationProbe />
        <Routes>
          <Route
            path="/catalog/notes/new/edit"
            element={
              <NoteEditForm
                cancelTo="/catalog/all-notes"
                noteId={null}
                selectedCollectionId={null}
              />
            }
          />
          <Route
            element={<div>All notes screen</div>}
            path="/catalog/all-notes"
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByLabelText("Denomination");
    await chooseSelectOption(user, "Collection", "Second");
    await screen.findByRole("combobox", { name: "Position in collection" });
    await user.click(
      screen.getByRole("checkbox", { name: "Show Second after saving" }),
    );
    await user.click(screen.getByRole("button", { name: "Add & close" }));

    expect(createNote).toHaveBeenCalledWith(expect.anything(), 2);
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/catalog/all-notes",
      );
    });
  });
});
