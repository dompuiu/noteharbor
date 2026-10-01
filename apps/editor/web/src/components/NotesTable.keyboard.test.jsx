import { MemoryRouter, useLocation } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getOperationStatus: vi.fn(),
  reorderNotes: vi.fn(),
  getScrapeStatus: vi.fn(),
  startScrape: vi.fn(),
}));

const virtualWindow = vi.hoisted(() => ({
  start: 0,
  end: Number.POSITIVE_INFINITY,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 43,
        start: index * 43,
        end: (index + 1) * 43,
      })).filter(
        (item) =>
          item.index >= virtualWindow.start && item.index < virtualWindow.end,
      ),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import {
  getNotes,
  getOperationStatus,
  getScrapeStatus,
} from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-hash">{location.hash}</output>;
}

function tableTree() {
  return (
    <MemoryRouter>
      <LocationProbe />
      <NotesTable
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>
  );
}

function renderTable() {
  return render(tableTree());
}

function currentHash() {
  return screen.getByTestId("route-hash").textContent;
}

async function findRow() {
  const denomination = await screen.findByText("ZZTEST");
  return denomination.closest("tr");
}

beforeEach(() => {
  virtualWindow.start = 0;
  virtualWindow.end = Number.POSITIVE_INFINITY;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 600,
    top: 0,
    left: 0,
    right: 1000,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  getNotes.mockResolvedValue({
    notes: [
      {
        id: 1,
        display_order: 1,
        denomination: "ZZTEST",
        issue_date: "",
        catalog_number: "",
        grading_company: "",
        grade: "",
        serial: "",
        url: "https://example.test/note/1",
        images: [],
        tags: [],
        scrape_status: "idle",
      },
    ],
  });
  getScrapeStatus.mockResolvedValue({ status: "idle", items: [] });
  getOperationStatus.mockResolvedValue({
    currentOperation: "idle",
    isBusy: false,
  });
});

describe("NotesTable keyboard focus inside a row", () => {
  test("Enter on the focused row opens the note", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  });

  test("Enter on a nested action button runs its own action, not the row's", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    expect(row).toHaveFocus();

    const deleteButton = screen.getByRole("button", {
      name: /delete ZZTEST/i,
    });
    deleteButton.focus();
    expect(deleteButton).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(confirmSpy).toHaveBeenCalledWith("Delete ZZTEST?");
    expect(currentHash()).not.toContain("slideshow");
  });

  test("Space on the nested checkbox toggles selection instead of opening the note", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });
    checkbox.focus();

    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(currentHash()).not.toContain("slideshow");
  });
});

describe("Active row highlight", () => {
  function notePayload(id, denomination) {
    return {
      id,
      display_order: id,
      denomination,
      issue_date: "",
      catalog_number: "",
      grading_company: "",
      grade: "",
      serial: "",
      url: "https://example.test/note/1",
      images: [],
      tags: [],
      scrape_status: "idle",
    };
  }

  async function openSlideshowOnFirstRow(user) {
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    const { rerender } = renderTable();

    const first = await screen.findByText("AAAA");
    const firstRow = first.closest("tr");
    await user.click(firstRow);

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
    return { firstRow, rerender };
  }

  test("Close button highlights the returned row", async () => {
    const user = userEvent.setup();
    const { firstRow } = await openSlideshowOnFirstRow(user);

    const closeButton = await screen.findByRole("button", {
      name: /close slideshow/i,
    });
    await user.click(closeButton);

    await waitFor(() => {
      expect(currentHash()).not.toContain("slideshow");
    });
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
    expect(firstRow).toHaveClass("table-row-link--active");
  });

  test("Escape highlights the returned row", async () => {
    const user = userEvent.setup();
    const { firstRow } = await openSlideshowOnFirstRow(user);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(currentHash()).not.toContain("slideshow");
    });
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
    expect(firstRow).toHaveClass("table-row-link--active");
  });

  test("moving focus to another row moves the active highlight", async () => {
    const user = userEvent.setup();
    const { firstRow } = await openSlideshowOnFirstRow(user);

    const closeButton = await screen.findByRole("button", {
      name: /close slideshow/i,
    });
    await user.click(closeButton);

    await waitFor(() => {
      expect(firstRow).toHaveClass("table-row-link--active");
    });

    const second = await screen.findByText("BBBB");
    const secondRow = second.closest("tr");
    await act(async () => {
      secondRow.focus();
    });

    await waitFor(() => {
      expect(firstRow).not.toHaveClass("table-row-link--active");
    });
  });

  test("moving to another note then closing highlights that note's row", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstRow(user);

    // Move through the slideshow to the second note, then close.
    await user.keyboard("{ArrowRight}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
    });

    const closeButton = await screen.findByRole("button", {
      name: /close slideshow/i,
    });
    await user.click(closeButton);

    await waitFor(() => {
      expect(currentHash()).not.toContain("slideshow");
    });

    const second = await screen.findByText("BBBB");
    const secondRow = second.closest("tr");
    await waitFor(() => {
      expect(secondRow).toHaveFocus();
    });
    expect(secondRow).toHaveClass("table-row-link--active");
  });

  test("scrolling the returned row out of view keeps the active highlight", async () => {
    const user = userEvent.setup();
    const { firstRow, rerender } = await openSlideshowOnFirstRow(user);

    const closeButton = await screen.findByRole("button", {
      name: /close slideshow/i,
    });
    await user.click(closeButton);

    await waitFor(() => {
      expect(firstRow).toHaveClass("table-row-link--active");
    });

    // Scroll the returned row out of the virtualized window: it unmounts.
    virtualWindow.start = 1;
    rerender(tableTree());

    await waitFor(() => {
      expect(screen.queryByText("AAAA")).not.toBeInTheDocument();
    });

    // Scroll back: the row remounts with its cursor highlight and focus.
    virtualWindow.start = 0;
    rerender(tableTree());

    const first = await screen.findByText("AAAA");
    const restoredRow = first.closest("tr");
    await waitFor(() => {
      expect(restoredRow).toHaveFocus();
    });
    expect(restoredRow).toHaveClass("table-row-link--active");
  });

  test("focusing a filter clears the active row highlight", async () => {
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    renderTable();

    const first = await screen.findByText("AAAA");
    const firstRow = first.closest("tr");
    await act(async () => {
      firstRow.focus();
    });

    await waitFor(() => {
      expect(firstRow).toHaveClass("table-row-link--active");
    });

    const filter = await screen.findByLabelText("Filter Denomination");
    await act(async () => {
      filter.focus();
    });

    await waitFor(() => {
      expect(firstRow).not.toHaveClass("table-row-link--active");
    });
  });

  test("mouse press does not paint the cursor; keyboard still claims it", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    renderTable();

    const first = await screen.findByText("AAAA");
    const firstRow = first.closest("tr");
    await act(async () => {
      firstRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      firstRow.focus();
    });

    expect(firstRow).toHaveFocus();
    expect(firstRow).not.toHaveClass("table-row-link--active");

    await user.keyboard("{ArrowDown}");

    const second = await screen.findByText("BBBB");
    const secondRow = second.closest("tr");
    await waitFor(() => {
      expect(secondRow).toHaveFocus();
    });
    expect(secondRow).toHaveClass("table-row-link--active");
  });

  test("ArrowDown cursor survives scrolling out of view and back", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    const { rerender } = renderTable();

    const first = await screen.findByText("AAAA");
    const firstRow = first.closest("tr");
    await act(async () => {
      firstRow.focus();
    });
    await user.keyboard("{ArrowDown}");

    const second = await screen.findByText("BBBB");
    await waitFor(() => {
      expect(second.closest("tr")).toHaveFocus();
    });

    // Scroll the cursor row out of the virtualized window: it unmounts.
    virtualWindow.start = 2;
    rerender(tableTree());

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    // Scroll back: the row remounts with its cursor highlight and focus.
    virtualWindow.start = 0;
    rerender(tableTree());

    const restored = await screen.findByText("BBBB");
    const restoredRow = restored.closest("tr");
    await waitFor(() => {
      expect(restoredRow).toHaveFocus();
    });
    expect(restoredRow).toHaveClass("table-row-link--active");
  });
});

describe("Home and End in the slideshow and image preview", () => {
  function notePayload(id, denomination) {
    return {
      id,
      display_order: id,
      denomination,
      issue_date: "",
      catalog_number: "",
      grading_company: "",
      grade: "",
      serial: "",
      url: `https://example.test/note/${id}`,
      images: [],
      tags: [],
      scrape_status: "idle",
    };
  }

  const threeNotes = [
    notePayload(1, "AAAA"),
    notePayload(2, "BBBB"),
    notePayload(3, "CCCC"),
  ];

  async function openSlideshowOnFirstNote(user) {
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    const first = await screen.findByText("AAAA");
    await user.click(first.closest("tr"));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  }

  test("End moves the slideshow to the last note and Home back to the first", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{End}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3");
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CCCC");

    await user.keyboard("{Home}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AAAA");
  });

  test("End and Home move the image preview to the last and first page", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    await user.keyboard("{End}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3/preview/back");
    });
    expect(screen.getByText("CCCC - Back")).toBeInTheDocument();
    expect(screen.getByText("6 / 6")).toBeInTheDocument();

    await user.keyboard("{Home}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });
    expect(screen.getByText("AAAA - Front")).toBeInTheDocument();
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
  });

  test("modified keys leave the image preview where it is", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    // Ctrl+Right no longer pages the image preview.
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(currentHash()).toContain("slideshow/1/preview/front");

    await user.keyboard("{End}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3/preview/back");
    });

    // Ctrl+Home does not jump back to the first page.
    await user.keyboard("{Control>}{Home}{/Control}");
    expect(currentHash()).toContain("slideshow/3/preview/back");
    expect(screen.getByText("CCCC - Back")).toBeInTheDocument();
  });

  test("Home and End change nothing in a Collection with a single note", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: [notePayload(1, "AAAA")] });
    renderTable();

    const first = await screen.findByText("AAAA");
    await user.click(first.closest("tr"));
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    await user.keyboard("{End}");
    await user.keyboard("{Home}");

    expect(currentHash()).toContain("slideshow/1");
  });

  test("Home and End suppress the browser default only when they move the slideshow", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    // Already on the first note: Home is a no-op and left to the browser.
    expect(fireEvent.keyDown(window, { key: "Home" })).toBe(true);

    // End moves the slideshow, so the browser default is suppressed.
    expect(fireEvent.keyDown(window, { key: "End" })).toBe(false);
  });

  test("the image preview suppresses the browser default only when it moves", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    // Already on the first page: Home is a no-op and left to the browser.
    expect(fireEvent.keyDown(window, { key: "Home" })).toBe(true);

    // End moves the preview, so the browser default is suppressed.
    expect(fireEvent.keyDown(window, { key: "End" })).toBe(false);
  });
});
