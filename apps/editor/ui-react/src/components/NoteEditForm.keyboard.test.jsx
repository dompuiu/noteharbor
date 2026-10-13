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
  vi.clearAllMocks();
  getNote.mockResolvedValue({ note: notePayload() });
  getNotes.mockResolvedValue({ notes: [] });
  getTags.mockResolvedValue({ tags: [] });
  updateNote.mockResolvedValue({ note: notePayload() });
});

describe("Note editor keyboard navigation", () => {
  test("Alt+ArrowRight and Alt+ArrowLeft change notes outside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  test("Alt+ArrowRight and Alt+ArrowLeft change notes from inside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    expect(input).toHaveFocus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);

    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
  });

  test("plain arrows, h/l and Shift/Ctrl/Cmd variants do not change notes", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();

    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("l");
    await user.keyboard("h");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    await user.keyboard("{Control>}{ArrowLeft}{/Control}");
    await user.keyboard("{Meta>}{ArrowRight}{/Meta}");
    await user.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    await user.keyboard("{Control>}l{/Control}");
    await user.keyboard("{Meta>}h{/Meta}");

    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
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

  test("Ctrl/Cmd+arrows keep the field's own caret handling and do not change notes", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.setSelectionRange(3, 3);
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(onNavigateNext).not.toHaveBeenCalled();
    // The field kept the key: the caret moved instead of the note changing.
    expect(input.selectionStart).toBe(4);

    input.setSelectionRange(3, 3);
    await user.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    expect(onNavigatePrevious).not.toHaveBeenCalled();
    expect(input.selectionStart).toBe(2);

    // Ctrl/Cmd + the letter aliases are equally left to the field.
    await user.keyboard("{Control>}l{/Control}");
    await user.keyboard("{Control>}h{/Control}");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
  });

  test("Shift+Arrow keeps the field's selection handling and does not change notes", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onNavigateNext).not.toHaveBeenCalled();

    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  test("Shift+h and Shift+l type capitals inside a field instead of changing notes", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("L");
    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(input).toHaveValue("TWOTESTL");

    await user.keyboard("H");
    expect(onNavigatePrevious).not.toHaveBeenCalled();
    expect(input).toHaveValue("TWOTESTLH");
  });

  test("navigation stops at the ends of the collection", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({
      nextNoteId: null,
      previousNoteId: null,
      onNavigateNext,
      onNavigatePrevious,
    });
    const user = userEvent.setup();

    input.blur();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");

    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  test("Alt+h/l do not change notes from a field or outside it", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("{Alt>}l{/Alt}");
    await user.keyboard("{Alt>}h{/Alt}");

    input.blur();
    await user.keyboard("{Alt>}l{/Alt}");
    await user.keyboard("{Alt>}h{/Alt}");

    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  test("Ctrl+S saves and keeps editing", async () => {
    const onSaveSuccess = vi.fn();
    const input = await renderLoadedForm({ onSaveSuccess });
    const user = userEvent.setup();

    await user.type(input, "!");
    await user.keyboard("{Control>}s{/Control}");

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalled();
    expect(onSaveSuccess.mock.calls[0][3]).toBe("stay");
  });

  test("Ctrl+Shift+S saves and closes", async () => {
    const onSaveSuccess = vi.fn();
    const input = await renderLoadedForm({ onSaveSuccess });
    const user = userEvent.setup();

    await user.type(input, "!");
    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    expect(onSaveSuccess.mock.calls[0][3]).toBe("return");
  });

  test("Cmd+S saves and keeps editing", async () => {
    const onSaveSuccess = vi.fn();
    const input = await renderLoadedForm({ onSaveSuccess });
    const user = userEvent.setup();

    await user.type(input, "!");
    await user.keyboard("{Meta>}s{/Meta}");

    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledTimes(1));
    expect(onSaveSuccess.mock.calls[0][3]).toBe("stay");
  });

  test("note fields disable browser autocomplete", async () => {
    await renderLoadedForm();

    for (const label of [
      "Denomination",
      "Date",
      "Catalog #",
      "Grading Company",
      "Grade",
      "Watermark",
      "Serial",
      "URL",
      "Notes",
    ]) {
      expect(await screen.findByLabelText(label)).toHaveAttribute(
        "autocomplete",
        "off",
      );
    }
    expect(document.getElementById("edit-note-form")).toHaveAttribute(
      "autocomplete",
      "off",
    );
  });
});
