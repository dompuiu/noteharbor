import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

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

// Runs before module imports, so appMode detects the desktop runtime.
const bridge = vi.hoisted(() => {
  const value = {
    getScrapeBrowserStatus: vi.fn(),
    openScrapeBrowser: vi.fn(),
    showNoteEditorTextMenu: vi.fn(),
  };
  window.noteHarborDesktop = value;
  return value;
});

import { getNote, getNotes, getTags, scrapePreview } from "../lib/api.js";
import { NoteEditForm } from "./NoteEditForm.jsx";

const NOTE_URL = "https://www.pmgnotes.com/certlookup/123456";

function notePayload() {
  return {
    id: 2,
    denomination: "TWOTEST",
    issue_date: "",
    catalog_number: "",
    grading_company: "PMG",
    grade: "",
    watermark: "",
    serial: "",
    url: NOTE_URL,
    notes: "",
    tags: [],
    images: [],
    updated_at: "2026-01-01T00:00:00Z",
  };
}

async function renderForm() {
  render(
    <MemoryRouter>
      <NoteEditForm noteId={2} selectedCollectionId={1} />
    </MemoryRouter>,
  );

  return screen.findByLabelText("Auto Populate fields from URL");
}

const availableStatus = {
  supported: true,
  available: true,
  launching: false,
  error: null,
};

const unavailableStatus = {
  supported: true,
  available: false,
  launching: false,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.getScrapeBrowserStatus.mockReset().mockResolvedValue(availableStatus);
  bridge.openScrapeBrowser.mockReset().mockResolvedValue(availableStatus);
  getNote.mockReset().mockResolvedValue({ note: notePayload() });
  getNotes.mockReset().mockResolvedValue({ notes: [] });
  getTags.mockReset().mockResolvedValue({ tags: [] });
  scrapePreview.mockReset().mockResolvedValue({ scraped_data: {}, images: [] });
});

describe("Note editor Autopopulate browser handling", () => {
  test("uses an already-available browser without launching Chrome", async () => {
    const user = userEvent.setup();
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await waitFor(() => expect(scrapePreview).toHaveBeenCalledTimes(1));
    expect(scrapePreview).toHaveBeenCalledWith(
      NOTE_URL,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(bridge.openScrapeBrowser).not.toHaveBeenCalled();
  });

  test("launches Chrome when it is not available, then scrapes", async () => {
    const user = userEvent.setup();
    bridge.getScrapeBrowserStatus.mockResolvedValue(unavailableStatus);
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await waitFor(() => expect(bridge.openScrapeBrowser).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(scrapePreview).toHaveBeenCalledTimes(1));
  });

  test("does not scrape when Chrome fails to launch", async () => {
    const user = userEvent.setup();
    bridge.getScrapeBrowserStatus.mockResolvedValue(unavailableStatus);
    bridge.openScrapeBrowser.mockResolvedValue({
      supported: true,
      available: false,
      launching: false,
      error: "Chrome could not be found.",
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await waitFor(() => expect(bridge.openScrapeBrowser).toHaveBeenCalledTimes(1));
    expect(scrapePreview).not.toHaveBeenCalled();
  });
});
