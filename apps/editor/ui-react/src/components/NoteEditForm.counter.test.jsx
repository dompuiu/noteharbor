import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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

function notePayload() {
  return {
    id: 1,
    collection_id: 1,
    display_order: 1,
    denomination: "5 Lei",
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

async function renderLoadedForm(props = {}) {
  const result = render(
    <MemoryRouter>
      <NoteEditForm noteId={1} selectedCollectionId={1} {...props} />
    </MemoryRouter>,
  );

  await screen.findByLabelText("Denomination");
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
});

describe("the note editor position counter", () => {
  test("sits in the header by default", async () => {
    const { container } = await renderLoadedForm();

    expect(container.querySelector(".note-counter")).not.toBeNull();
  });

  test("can be hidden where there is no table sequence", async () => {
    const { container } = await renderLoadedForm({ showCounter: false });

    expect(container.querySelector(".note-counter")).toBeNull();
    expect(container.querySelector(".note-editor-position")).toBeNull();
  });
});
