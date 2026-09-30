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
  useCollections: () => ({ collections: [] }),
}));

import { getNote, getNotes, getTags } from "../lib/api.js";

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
      <NoteEditForm
        noteId={2}
        nextNoteId={3}
        previousNoteId={1}
        selectedCollectionId={1}
        {...props}
      />
    </MemoryRouter>,
  );

  const denomination = await screen.findByLabelText("Denomination");
  await waitFor(() => expect(denomination).toHaveFocus());
  return denomination;
}

beforeEach(() => {
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
});

describe("Note editor keyboard navigation", () => {
  test("ArrowRight and ArrowLeft change notes outside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("{ArrowRight}");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);

    await user.keyboard("{ArrowLeft}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  test("h and l change notes outside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("l");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);

    await user.keyboard("h");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  test("plain arrows and h/l keep their text behaviour inside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.type(input, "l");
    await user.keyboard("{ArrowLeft}");

    expect(input).toHaveValue("TWOTESTl");
    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  test("Shift+Arrow changes notes from inside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);

    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  test("does not change notes when there is no adjacent note", async () => {
    const onNavigateNext = vi.fn();
    const input = await renderLoadedForm({
      nextNoteId: null,
      onNavigateNext,
    });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("{ArrowRight}");
    expect(onNavigateNext).not.toHaveBeenCalled();
  });

  test("modifier+Arrow does not change notes", async () => {
    const onNavigateNext = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("{Meta>}{ArrowRight}{/Meta}");
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(onNavigateNext).not.toHaveBeenCalled();
  });
});
