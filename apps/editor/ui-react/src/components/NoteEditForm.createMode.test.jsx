import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NoteEditForm } from "./NoteEditForm.jsx";

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
  useCollections: () => ({ collections: [{ id: 1, name: "Test" }] }),
}));

import { getNote, getNotes, getTags } from "../lib/api.js";

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
    await waitFor(() => {
      expect(screen.getByText("Add note")).toBeInTheDocument();
    });
    expect(getNote).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("Denomination")).toHaveValue("");
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
    expect(getNote).toHaveBeenCalledWith(1, 1);
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
});
