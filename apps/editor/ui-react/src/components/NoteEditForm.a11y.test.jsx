import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  useCollections: () => ({ collections: [] }),
}));

import { getNote, getNotes, getTags, updateNote } from "../lib/api.js";

function notePayload() {
  return {
    id: 2,
    denomination: "TWOTEST",
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
  render(
    <MemoryRouter>
      <NoteEditForm noteId={2} selectedCollectionId={1} {...props} />
    </MemoryRouter>,
  );

  await screen.findByLabelText("Denomination");
}

beforeEach(() => {
  vi.clearAllMocks();
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
  updateNote.mockResolvedValue({ note: notePayload() });
});

describe("Note editor save announcements", () => {
  test("a rejected save is announced as an alert", async () => {
    updateNote.mockRejectedValueOnce(new Error("The note could not be saved."));
    const user = userEvent.setup();
    await renderLoadedForm();

    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The note could not be saved.");
  });

  test("the form is busy while a save is in flight", async () => {
    let resolveSave;
    updateNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const user = userEvent.setup();
    await renderLoadedForm();
    const form = document.querySelector("#edit-note-form");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(form).toHaveAttribute("aria-busy", "true"));

    await act(async () => {
      resolveSave({ note: notePayload() });
    });

    await waitFor(() => expect(form).not.toHaveAttribute("aria-busy"));
  });

  test("a save that stays on the note is announced", async () => {
    const onSaveSuccess = vi.fn();
    const user = userEvent.setup();
    await renderLoadedForm({ onSaveSuccess });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    const announcer = document.querySelector(".note-editor-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer).toHaveTextContent("Note saved.");
  });
});
