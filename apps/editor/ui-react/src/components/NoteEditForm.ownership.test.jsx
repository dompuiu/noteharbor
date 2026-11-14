import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import {
  createNote,
  getNote,
  getNotes,
  getTags,
  reorderNotes,
  updateNote,
} from "../lib/api.js";

function notePayload(overrides = {}) {
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
    owned: true,
    tags: [],
    images: [],
    scraped_data: null,
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderForm(props) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <NoteEditForm overlay selectedCollectionId={1} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
  reorderNotes.mockResolvedValue({ notes: [] });
  createNote.mockImplementation(async (payload) => ({
    note: notePayload({ ...payload, id: 2 }),
  }));
  updateNote.mockImplementation(async (_id, payload) => ({
    note: notePayload({ ...payload, id: 1 }),
  }));
});

describe("Note editor ownership toggle", () => {
  test("create mode starts owned and submits the toggle value", async () => {
    const onSaveSuccess = vi.fn();
    const user = userEvent.setup();
    renderForm({ noteId: null, onSaveSuccess });

    const toggle = await screen.findByRole("checkbox", {
      name: "I own this note",
    });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(toggle).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({ owned: false }),
      1,
    );
  });

  test("create mode without a change submits owned true", async () => {
    const onSaveSuccess = vi.fn();
    const user = userEvent.setup();
    renderForm({ noteId: null, onSaveSuccess });

    await screen.findByRole("checkbox", { name: "I own this note" });
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    expect(createNote).toHaveBeenCalledWith(
      expect.objectContaining({ owned: true }),
      1,
    );
  });

  test("edit mode loads the note's owned flag and saves a flip", async () => {
    getNote.mockResolvedValue({ note: notePayload({ owned: false }) });
    const onSaveSuccess = vi.fn();
    const user = userEvent.setup();
    renderForm({ noteId: 1, onSaveSuccess });

    const toggle = await screen.findByRole("checkbox", {
      name: "I own this note",
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ owned: true }),
      1,
    );
  });
});
