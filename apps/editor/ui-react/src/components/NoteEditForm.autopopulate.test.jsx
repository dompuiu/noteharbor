import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

  return screen.findByRole("button", { name: "Scrape grading page" });
}

function scrapeReport() {
  return document.querySelector(".scrape-result-message");
}

async function findScrapeStatus(text) {
  const status = scrapeReport();
  expect(status).toHaveAttribute("aria-live", "polite");
  await waitFor(() => expect(status).toHaveTextContent(text));
  return status;
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

afterEach(() => {
  vi.useRealTimers();
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
      expect.objectContaining({ timeoutMs: 30000 }),
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

  test("keeps waiting for Chrome past the old 10-second gate", async () => {
    const button = await renderForm();
    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());

    vi.useFakeTimers();
    const startedAt = Date.now();
    bridge.getScrapeBrowserStatus.mockImplementation(async () =>
      Date.now() - startedAt >= 15000 ? availableStatus : unavailableStatus,
    );
    bridge.openScrapeBrowser.mockResolvedValue(unavailableStatus);

    await act(async () => {
      fireEvent.click(button);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });

    expect(bridge.openScrapeBrowser).toHaveBeenCalledTimes(1);
    expect(scrapePreview).toHaveBeenCalledTimes(1);
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

  test("names the action and shows progress on the control while scraping", async () => {
    const user = userEvent.setup();
    let resolvePreview;
    scrapePreview.mockReturnValue(
      new Promise((resolve) => {
        resolvePreview = resolve;
      }),
    );
    const button = await renderForm();

    expect(button).toHaveTextContent("Scrape page");
    // The full verb and object stay in the accessible name.
    expect(button).toHaveAccessibleName("Scrape grading page");
    // The report's live region exists before a scrape writes into it.
    expect(scrapeReport()).toBeEmptyDOMElement();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    const busyButton = await screen.findByRole("button", {
      name: "Scraping grading page…",
    });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(
      busyButton.querySelector(".scrape-spinner"),
    ).toHaveAttribute("aria-hidden", "true");

    await act(async () => {
      resolvePreview({ scraped_data: {}, images: [] });
    });
  });

  test("reports a filled scrape with its source and count, and marks each field", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: {
        ...notePayload(),
        denomination: "",
        grade: "",
        serial: "",
        watermark: "",
      },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { grade: "65 EPQ", serial_number: "123456", watermark: "ABC" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    const status = await findScrapeStatus("Filled 3 fields from PMG.");
    expect(screen.getByLabelText("Grade")).toHaveValue("65 EPQ");
    expect(screen.getByLabelText("Serial")).toHaveValue("123456");
    expect(screen.getByLabelText("Watermark")).toHaveValue("ABC");

    const gradeBlock = screen.getByLabelText("Grade").closest(".field-block");
    const serialBlock = screen.getByLabelText("Serial").closest(".field-block");
    expect(within(gradeBlock).getByText("Scraped")).toBeInTheDocument();
    expect(within(serialBlock).getByText("Scraped")).toBeInTheDocument();
    expect(screen.getByLabelText("Grade")).toHaveAccessibleDescription(
      "Scraped from PMG",
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByLabelText("Grade")).toHaveValue("");
    expect(screen.getByLabelText("Serial")).toHaveValue("");
    expect(screen.getByLabelText("Watermark")).toHaveValue("");
    expect(scrapeReport()).toBeEmptyDOMElement();
    expect(within(gradeBlock).queryByText("Scraped")).not.toBeInTheDocument();
  });

  test("marks a scraped Notes field too", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: {
        ...notePayload(),
        url: "https://www.pcgs.com/banknotes/cert/123",
        grading_company: "PCGS",
        grade: "",
        notes: "",
      },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { display_grade: "65", banknote_details: "Toning" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await findScrapeStatus("Filled 2 fields from PCGS.");
    expect(screen.getByLabelText("Notes")).toHaveValue("Toning");
    const notesBlock = screen.getByLabelText("Notes").closest(".field-block");
    expect(within(notesBlock).getByText("Scraped")).toBeInTheDocument();
  });

  test("reports the total after conflict decisions and undoes every scraped field", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grade: "" },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { denomination: "1 Dollar", grade: "65 EPQ" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    expect(
      await screen.findByRole("heading", { name: "Review scraped conflicts" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Grade")).toHaveValue("65 EPQ");
    expect(screen.getByLabelText("Denomination")).toHaveValue("TWOTEST");
    expect(scrapeReport()).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "Use all scraped" }));
    await user.click(screen.getByRole("button", { name: "Apply selected changes" }));

    await findScrapeStatus("Filled 2 fields from PMG.");
    expect(screen.getByLabelText("Denomination")).toHaveValue("1 Dollar");
    expect(screen.getByLabelText("Grade")).toHaveValue("65 EPQ");

    const denominationBlock = screen
      .getByLabelText("Denomination")
      .closest(".field-block");
    expect(within(denominationBlock).getByText("Scraped")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByLabelText("Denomination")).toHaveValue("TWOTEST");
    expect(screen.getByLabelText("Grade")).toHaveValue("");
  });

  test("announces a scrape that changes nothing instead of staying silent", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grade: "65 EPQ" },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { grade: "65 EPQ" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await findScrapeStatus("No fields changed; the note already matches PMG.");
  });

  test("reports keeping the current values when every conflict is kept", async () => {
    const user = userEvent.setup();
    scrapePreview.mockResolvedValue({
      scraped_data: { denomination: "1 Dollar" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await screen.findByRole("heading", { name: "Review scraped conflicts" });
    await user.click(screen.getByRole("button", { name: "Apply selected changes" }));

    await findScrapeStatus("No fields changed; the current values were kept.");
    expect(screen.getByLabelText("Denomination")).toHaveValue("TWOTEST");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  test("cancelling the conflict review keeps the filled fields and reports them", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grade: "" },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { denomination: "1 Dollar", grade: "65 EPQ" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await screen.findByRole("heading", { name: "Review scraped conflicts" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await findScrapeStatus("Filled 1 field from PMG.");
    expect(screen.getByLabelText("Grade")).toHaveValue("65 EPQ");
    expect(screen.getByLabelText("Denomination")).toHaveValue("TWOTEST");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  test("keeps the zero-updates guidance when only the URL infers a company", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grading_company: "" },
    });
    scrapePreview.mockResolvedValue({ scraped_data: {}, images: [] });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No fields were found on the page. If Chrome is showing a CAPTCHA or a setup screen, complete it and try Auto Populate again.",
    );
    // The URL alone is not a fill: the company stays empty.
    expect(screen.getByLabelText("Grading Company")).toHaveValue("");
    expect(scrapeReport()).toBeEmptyDOMElement();
  });

  test("keeps scraped images when the page yields no text fields", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grading_company: "" },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: {},
      images: [
        {
          type: "front",
          variant: "full",
          sourceUrl: "https://example.com/front.jpg",
        },
      ],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No fields were found on the page.",
    );
    expect(screen.getAllByText("New image ready").length).toBeGreaterThan(0);
  });

  test("a field edited after the scrape drops its scraped mark", async () => {
    const user = userEvent.setup();
    getNote.mockResolvedValue({
      note: { ...notePayload(), grade: "" },
    });
    scrapePreview.mockResolvedValue({
      scraped_data: { grade: "65 EPQ" },
      images: [],
    });
    const button = await renderForm();

    await waitFor(() => expect(bridge.getScrapeBrowserStatus).toHaveBeenCalled());
    await user.click(button);

    await findScrapeStatus("Filled 1 field from PMG.");
    const gradeBlock = screen.getByLabelText("Grade").closest(".field-block");
    expect(within(gradeBlock).getByText("Scraped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Grade"));
    await user.type(screen.getByLabelText("Grade"), "66");

    expect(within(gradeBlock).queryByText("Scraped")).not.toBeInTheDocument();
    // The only scraped value is now the user's, so there is nothing to undo.
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });
});
