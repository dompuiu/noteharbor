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

  test("Shift, Ctrl and Cmd + arrows change notes outside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    await user.keyboard("{Meta>}{ArrowRight}{/Meta}");
    expect(onNavigateNext).toHaveBeenCalledTimes(3);

    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await user.keyboard("{Control>}{ArrowLeft}{/Control}");
    await user.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(3);
  });

  test("Shift, Ctrl and Cmd + h/l change notes outside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    input.blur();

    await user.keyboard("{Shift>}l{/Shift}");
    await user.keyboard("{Control>}l{/Control}");
    await user.keyboard("{Meta>}l{/Meta}");
    expect(onNavigateNext).toHaveBeenCalledTimes(3);

    await user.keyboard("{Shift>}h{/Shift}");
    await user.keyboard("{Control>}h{/Control}");
    await user.keyboard("{Meta>}h{/Meta}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(3);
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

  test("Shift+h and Shift+l change notes from inside a field", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("{Shift>}l{/Shift}");
    expect(onNavigateNext).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("TWOTEST");

    await user.keyboard("{Shift>}h{/Shift}");
    expect(onNavigatePrevious).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("TWOTEST");
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
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("l");
    await user.keyboard("h");

    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });

  test("Alt+arrow and Alt+h/l do not change notes from a field or outside it", async () => {
    const onNavigateNext = vi.fn();
    const onNavigatePrevious = vi.fn();
    const input = await renderLoadedForm({ onNavigateNext, onNavigatePrevious });
    const user = userEvent.setup();

    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    await user.keyboard("{Alt>}l{/Alt}");
    await user.keyboard("{Alt>}h{/Alt}");

    input.blur();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await user.keyboard("{Alt>}l{/Alt}");

    expect(onNavigateNext).not.toHaveBeenCalled();
    expect(onNavigatePrevious).not.toHaveBeenCalled();
  });
});
