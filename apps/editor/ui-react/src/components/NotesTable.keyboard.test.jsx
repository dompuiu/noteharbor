import { MemoryRouter, useLocation } from "react-router-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
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
  reorderNotes,
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
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
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

function notePayload(id, denomination, images = []) {
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
    images,
    tags: [],
  };
}

const threeNotes = [
  notePayload(1, "AAAA"),
  notePayload(2, "BBBB"),
  notePayload(3, "CCCC"),
];

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
      },
    ],
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

  test("Space on the focused row toggles its selection instead of opening the note", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });

    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(currentHash()).not.toContain("slideshow");

    await user.keyboard(" ");

    expect(checkbox).not.toBeChecked();
    expect(currentHash()).not.toContain("slideshow");
  });

  test("Space on the denomination link toggles selection instead of scrolling", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });
    const link = screen.getByRole("link", { name: "ZZTEST" });

    row.focus();
    link.focus();
    expect(link).toHaveFocus();

    // Space's browser default scrolls the table when focus is on a link.
    expect(fireEvent.keyDown(link, { key: " " })).toBe(false);

    expect(checkbox).toBeChecked();
    expect(currentHash()).not.toContain("slideshow");

    await user.keyboard(" ");

    expect(checkbox).not.toBeChecked();
  });

  test("Space on the actions button toggles selection instead of opening its menu", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });
    const actionsButton = screen.getByRole("button", {
      name: "Actions for ZZTEST",
    });

    row.focus();
    actionsButton.focus();
    expect(actionsButton).toHaveFocus();

    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.keyboard(" ");

    expect(checkbox).not.toBeChecked();
  });

  test("ArrowDown from a focused row checkbox moves focus to the next row", async () => {
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    renderTable();
    const user = userEvent.setup();
    const checkbox = await screen.findByRole("checkbox", {
      name: /select AAAA/i,
    });

    checkbox.focus();
    expect(checkbox).toHaveFocus();

    await user.keyboard("{ArrowDown}");

    const secondRow = (await screen.findByText("BBBB")).closest("tr");
    await waitFor(() => {
      expect(secondRow).toHaveFocus();
    });
  });

  test("Enter on a nested action button runs its own action, not the row's", async () => {
    renderTable();
    const user = userEvent.setup();
    const row = await findRow();

    row.focus();
    expect(row).toHaveFocus();

    const actionsButton = screen.getByRole("button", {
      name: "Actions for ZZTEST",
    });
    actionsButton.focus();
    expect(actionsButton).toHaveFocus();

    await user.keyboard("{Enter}");

    const deleteItem = await screen.findByRole("menuitem", {
      name: "Delete",
    });
    deleteItem.focus();
    expect(deleteItem).toHaveFocus();

    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Delete ZZTEST?" }),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
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

  test("Escape on the row checkbox drops the row cursor to the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = await findRow();
    const checkbox = screen.getByRole("checkbox", {
      name: /select ZZTEST/i,
    });

    checkbox.focus();
    expect(checkbox).toHaveFocus();
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    await user.keyboard("{Escape}");

    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
  });

  test("Escape on the denomination link drops the row cursor to the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = await findRow();
    const link = screen.getByRole("link", { name: "ZZTEST" });

    link.focus();
    expect(link).toHaveFocus();
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    await user.keyboard("{Escape}");

    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
  });

  test("Escape on the actions button drops the row cursor to the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = await findRow();
    const actionsButton = screen.getByRole("button", {
      name: "Actions for ZZTEST",
    });

    actionsButton.focus();
    expect(actionsButton).toHaveFocus();
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    await user.keyboard("{Escape}");

    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("Escape closes an open actions menu before dropping the row cursor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = await findRow();
    const actionsButton = screen.getByRole("button", {
      name: "Actions for ZZTEST",
    });

    actionsButton.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("menu", { name: "Actions for ZZTEST" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(actionsButton).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    await user.keyboard("{Escape}");

    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
  });
});

describe("Table shortcuts while a row checkbox has focus", () => {
  async function focusRowCheckbox() {
    const checkbox = await screen.findByRole("checkbox", {
      name: /select BBBB/i,
    });
    checkbox.focus();
    expect(checkbox).toHaveFocus();
    return checkbox;
  }

  beforeEach(() => {
    getNotes.mockResolvedValue({ notes: threeNotes });
  });

  test("/ focuses the search field", async () => {
    const user = userEvent.setup();
    renderTable();
    await focusRowCheckbox();

    await user.keyboard("/");

    expect(
      screen.getByRole("searchbox", { name: "Filter Catalog" }),
    ).toHaveFocus();
  });

  test("o opens the focused row's actions menu", async () => {
    const user = userEvent.setup();
    renderTable();
    await focusRowCheckbox();

    await user.keyboard("o");

    expect(
      await screen.findByRole("menu", { name: "Actions for BBBB" }),
    ).toBeInTheDocument();
  });

  test("? opens the keyboard shortcut help", async () => {
    const user = userEvent.setup();
    renderTable();
    await focusRowCheckbox();

    await user.keyboard("?");

    expect(
      await screen.findByRole("dialog", { name: "Keyboard shortcuts" }),
    ).toBeInTheDocument();
  });

  test("Enter opens the focused note", async () => {
    const user = userEvent.setup();
    renderTable();
    await focusRowCheckbox();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
    });
  });
});

describe("Active row highlight", () => {
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

  test("focus entering the sidebar keeps the active highlight", async () => {
    renderTable();
    const row = (await screen.findByText("ZZTEST")).closest("tr");
    await act(async () => {
      row.focus();
    });
    await waitFor(() => {
      expect(row).toHaveClass("table-row-link--active");
    });

    const sidebar = document.createElement("nav");
    sidebar.id = "app-sidebar";
    sidebar.innerHTML = "<button type='button'>Banknotes</button>";
    document.body.append(sidebar);
    const railButton = sidebar.querySelector("button");

    await act(async () => {
      railButton.focus();
    });

    expect(row).toHaveClass("table-row-link--active");

    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.append(outside);

    await act(async () => {
      outside.focus();
    });

    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
    sidebar.remove();
    outside.remove();
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
    const user = userEvent.setup();
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

    const filter = await screen.findByRole("searchbox", {
      name: "Filter Catalog",
    });
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
  async function openSlideshowOnFirstNote(user) {
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    const first = await screen.findByText("AAAA");
    await user.click(first.closest("tr"));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  }

  // The table keeps its own h1 behind the full-screen slideshow, so scope the
  // heading query to the overlay rather than matching either document title.
  function slideshowHeading() {
    const slideshow = document.querySelector(".slideshow-screen");
    return within(slideshow).getByRole("heading", { level: 1 });
  }

  test("End moves the slideshow to the last note and Home back to the first", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{End}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3");
    });
    expect(slideshowHeading()).toHaveTextContent("CCCC");

    await user.keyboard("{Home}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
    expect(slideshowHeading()).toHaveTextContent("AAAA");
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

  test("Ctrl+arrows page in fit view while modified Home stays put", async () => {
    const user = userEvent.setup();
    await openSlideshowOnFirstNote(user);

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    // Ctrl+Right pages the image preview in fit view, like Shift already did.
    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/back");
    });

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

describe("Arrow modifiers and h/j/k/l aliases", () => {
  test("table row focus moves on plain j/k while a held Shift leaves it alone", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    renderTable();

    const firstRow = (await screen.findByText("AAAA")).closest("tr");
    const secondRow = (await screen.findByText("BBBB")).closest("tr");

    await act(async () => {
      firstRow.focus();
    });

    await user.keyboard("j");
    await waitFor(() => {
      expect(secondRow).toHaveFocus();
    });

    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    await user.keyboard("{Shift>}k{/Shift}");
    expect(firstRow).not.toHaveFocus();
    expect(secondRow).toHaveFocus();

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("{Shift>}j{/Shift}");
    expect(secondRow).toHaveFocus();

    await user.keyboard("k");
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
  });

  test("Alt+Down reorders the focused row while Shift+Down leaves it alone", async () => {
    const user = userEvent.setup();
    const notes = [
      notePayload(1, "AAAA"),
      notePayload(2, "BBBB"),
      notePayload(3, "CCCC"),
    ];
    getNotes.mockResolvedValue({ notes });
    reorderNotes.mockImplementation((ids) =>
      Promise.resolve({
        notes: ids.map((id) => notes.find((item) => item.id === id)),
      }),
    );
    renderTable();

    const firstRow = (await screen.findByText("AAAA")).closest("tr");
    await act(async () => {
      firstRow.focus();
    });

    // Shift stays reserved for range selection: it must not move the row.
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(firstRow).toHaveFocus();
    expect(reorderNotes).not.toHaveBeenCalled();

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");

    await waitFor(() => {
      expect(reorderNotes).toHaveBeenCalledWith([2, 1, 3], 1);
    });
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
    expect(firstRow).toHaveClass("table-row-link--active");
  });

  test("Shift+Down in a filter field does not pull focus into the table", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({
      notes: [notePayload(1, "AAAA"), notePayload(2, "BBBB")],
    });
    renderTable();

    const firstRow = (await screen.findByText("AAAA")).closest("tr");
    const filter = await screen.findByRole("searchbox", {
      name: "Filter Catalog",
    });

    await act(async () => {
      filter.focus();
    });

    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(filter).toHaveFocus();
    expect(firstRow).not.toHaveFocus();

    // Plain Down still jumps from the filter to the first row.
    await user.keyboard("{ArrowDown}");
    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
  });

  test("h/l change notes and j/k scroll the Note slideshow", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    const { container } = renderTable();

    await user.click((await screen.findByText("AAAA")).closest("tr"));
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    await user.keyboard("l");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2");
    });

    await user.keyboard("h");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    const slideScreen = container.querySelector(".slideshow-screen");
    Object.defineProperty(slideScreen, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(slideScreen, "clientHeight", {
      configurable: true,
      value: 600,
    });
    const scrollBy = vi.fn();
    slideScreen.scrollBy = scrollBy;

    await user.keyboard("j");
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 80 });

    await user.keyboard("k");
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -80 });

    scrollBy.mockClear();
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("{Shift>}{ArrowUp}{/Shift}");
    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("Shift keeps its own keys in the Note slideshow", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click((await screen.findByText("AAAA")).closest("tr"));
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    // Only modified arrows are inert; Shift+End/Home still navigate.
    await user.keyboard("{Shift>}{End}{/Shift}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/3");
    });

    await user.keyboard("{Shift>}{Home}{/Shift}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    // Shift+Enter still opens the preview.
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });
  });

  test("Shift/Ctrl/Cmd + Left/Right and h/l page images in fit view", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click((await screen.findByText("AAAA")).closest("tr"));
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/back");
    });

    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2/preview/front");
    });

    await user.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/back");
    });

    await user.keyboard("l");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/2/preview/front");
    });

    await user.keyboard("h");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/back");
    });

    // Modified vertical arrows do nothing in fit view.
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    await user.keyboard("{Control>}{ArrowUp}{/Control}");
    expect(currentHash()).toContain("slideshow/1/preview/back");
  });

  test("modified arrows pan the zoomed image while Alt stays inert", async () => {
    // jsdom never loads images; let the popover's off-screen decode settle.
    window.HTMLImageElement.prototype.decode = () => Promise.resolve();
    onTestFinished(() => {
      delete window.HTMLImageElement.prototype.decode;
    });
    const user = userEvent.setup();
    const imageNote = notePayload(1, "AAAA", [
      { type: "front", variant: "full", localPath: "/api/notes/1/front" },
      { type: "back", variant: "full", localPath: "/api/notes/1/back" },
    ]);
    getNotes.mockResolvedValue({
      notes: [imageNote, notePayload(2, "BBBB")],
    });
    renderTable();

    await user.click((await screen.findByText("AAAA")).closest("tr"));
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });

    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1/preview/front");
    });

    const overlay = document.querySelector(".image-popover-overlay");
    const image = await waitFor(() => {
      const full = overlay.querySelector(".image-popover-full");
      expect(full).not.toBeNull();
      return full;
    });
    Object.defineProperty(image, "naturalWidth", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(image, "naturalHeight", {
      configurable: true,
      value: 800,
    });
    fireEvent.load(image);
    fireEvent.doubleClick(image);

    expect(image.style.transform).toBe("translate(0px, 0px)");

    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(image.style.transform).toBe("translate(-12.5px, 0px)");

    await user.keyboard("{Control>}{ArrowRight}{/Control}");
    expect(image.style.transform).toBe("translate(-25px, 0px)");

    await user.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    expect(image.style.transform).toBe("translate(-12.5px, 0px)");

    // h/j/k/l alias the arrows, including the Shift-held spelling.
    await user.keyboard("{Shift>}l{/Shift}");
    expect(image.style.transform).toBe("translate(-25px, 0px)");

    await user.keyboard("{Control>}{ArrowDown}{/Control}");
    expect(image.style.transform).toMatch(
      /^translate\(-25px, -11\.66\d*px\)$/,
    );

    await user.keyboard("{Shift>}k{/Shift}");
    expect(image.style.transform).toBe("translate(-25px, 0px)");

    // Alt+arrow is inert even while the image is pannable.
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(image.style.transform).toBe("translate(-25px, 0px)");
  });

  test("the shortcut help lists the new modifiers and aliases", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });

    function keysOf(description) {
      const row = within(dialog).getByText(description).closest("li");
      return Array.from(row.querySelectorAll("kbd"), (key) => key.textContent);
    }

    // The column-pan row gains the h/l aliases.
    expect(
      keysOf("Pan the columns to reveal ones hidden by a narrow window"),
    ).toEqual(["←", "→", "h", "l"]);

    // The column-jump row gains the Shift variant.
    expect(keysOf("Jump to the first / last column")).toEqual([
      "Ctrl/Cmd/Shift",
      "←",
      "→",
    ]);

    // The note editor's previous/next rows use Alt+arrows.
    expect(keysOf("Go to the previous note")).toEqual(["Alt", "←"]);
    expect(keysOf("Go to the next note")).toEqual(["Alt", "→"]);

    // The note editor advertises the save shortcuts.
    expect(keysOf("Save the note and keep editing")).toEqual(["Ctrl/Cmd", "S"]);
    expect(keysOf("Save the note and close the editor")).toEqual([
      "Ctrl/Cmd",
      "Shift",
      "S",
    ]);
    expect(keysOf("Delete the note being edited")).toEqual(["Ctrl/Cmd", "D"]);
    expect(keysOf("Add a note before the one being edited")).toEqual([
      "Ctrl/Cmd",
      "A",
    ]);

    // The image preview advertises its zoom, pan, wheel and double-click
    // controls.
    expect(keysOf("Zoom in / out")).toEqual(["+", "−"]);
    expect(keysOf("Pan the zoomed image")).toEqual([
      "Ctrl/Cmd/Shift",
      "←",
      "↑",
      "→",
      "↓",
    ]);
    expect(keysOf("Zoom in / out at the pointer")).toEqual(["Wheel"]);
    expect(keysOf("Zoom in, or fit the image again")).toEqual([
      "Double-click",
    ]);
  });

  test("the shortcut help notes Shift+Up/Down is inert without advertising it", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.keyboard("?");
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    });

    const rowFocusRow = within(dialog)
      .getByText(/^Move focus between rows \(↑ from the first row/)
      .closest("li");

    // The row advertises only the plain keys, and says Shift does nothing.
    expect(
      Array.from(rowFocusRow.querySelectorAll("kbd"), (key) => key.textContent),
    ).toEqual(["↑", "↓"]);
    expect(rowFocusRow.textContent).toContain("Shift+↑/↓ does nothing");
  });
});

describe("Selection actions tab cycle", () => {
  function actionsButton(denomination) {
    return screen.getByRole("button", {
      name: `Actions for ${denomination}`,
    });
  }

  function checkbox(denomination) {
    return screen.getByRole("checkbox", {
      name: `Select ${denomination}`,
    });
  }

  test("Tab after a checkbox selection lands on the bar's first action", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click(await screen.findByRole("checkbox", { name: "Select AAAA" }));

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 1 selected note down",
    });

    await user.tab();

    expect(moveDown).toHaveFocus();
  });

  test("Tab walks Move down, Tags, Delete, Clear, then the last selected row's checkbox", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click(await screen.findByRole("checkbox", { name: "Select AAAA" }));

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 1 selected note down",
    });
    const tagsButton = within(bar).getByRole("button", { name: "Tags…" });
    const deleteButton = within(bar).getByRole("button", { name: "Delete" });
    const clearButton = within(bar).getByRole("button", {
      name: "Clear selection",
    });

    await user.tab();
    expect(moveDown).toHaveFocus();

    await user.tab();
    expect(tagsButton).toHaveFocus();

    await user.tab();
    expect(deleteButton).toHaveFocus();

    await user.tab();
    expect(clearButton).toHaveFocus();

    // A mouse selection leaves no live row cursor, so the exit targets the
    // row selected most recently.
    await user.tab();
    expect(checkbox("AAAA")).toHaveFocus();
  });

  test("moving the row cursor while a selection exists re-arms the bar", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    const firstRow = (await screen.findByText("AAAA")).closest("tr");
    firstRow.focus();

    await user.keyboard(" ");
    expect(checkbox("AAAA")).toBeChecked();

    await user.keyboard("{ArrowDown}");

    const secondRow = (await screen.findByText("BBBB")).closest("tr");
    await waitFor(() => {
      expect(secondRow).toHaveFocus();
    });

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 1 selected note down",
    });

    await user.tab();
    expect(moveDown).toHaveFocus();
    expect(secondRow).toHaveClass("table-row-link--active");

    // After the bar, focus returns to the row the cursor now sits on.
    const tagsButton = within(bar).getByRole("button", { name: "Tags…" });
    const deleteButton = within(bar).getByRole("button", { name: "Delete" });
    const clearButton = within(bar).getByRole("button", {
      name: "Clear selection",
    });
    await user.tab();
    expect(tagsButton).toHaveFocus();
    await user.tab();
    expect(deleteButton).toHaveFocus();
    await user.tab();
    expect(clearButton).toHaveFocus();
    await user.tab();
    expect(checkbox("BBBB")).toHaveFocus();
  });

  test("select-all also puts the bar first in the tab cycle", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click(
      await screen.findByRole("checkbox", { name: "Select all visible rows" }),
    );

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const tagsButton = within(bar).getByRole("button", { name: "Tags…" });
    const deleteButton = within(bar).getByRole("button", { name: "Delete" });
    const clearButton = within(bar).getByRole("button", {
      name: "Clear selection",
    });

    await user.tab();
    expect(tagsButton).toHaveFocus();

    await user.tab();
    expect(deleteButton).toHaveFocus();

    await user.tab();
    expect(clearButton).toHaveFocus();

    // With no cursor, the exit is the row selected most recently, which for
    // select-all is the last row in the current view.
    await user.tab();
    expect(checkbox("CCCC")).toHaveFocus();
  });

  test("Shift+Tab from the first bar action goes to the cursor row's actions button", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    const firstRow = (await screen.findByText("AAAA")).closest("tr");
    firstRow.focus();
    await user.keyboard(" ");

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 1 selected note down",
    });

    await user.tab();
    expect(moveDown).toHaveFocus();

    await user.tab({ shift: true });

    expect(actionsButton("AAAA")).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  test("focus moving outside the table disarms the jump to the bar", async () => {
    const user = userEvent.setup();
    getNotes.mockResolvedValue({ notes: threeNotes });
    renderTable();

    await user.click(await screen.findByRole("checkbox", { name: "Select AAAA" }));

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const deleteButton = within(bar).getByRole("button", { name: "Delete" });

    const search = screen.getByRole("searchbox");
    await user.click(search);
    expect(search).toHaveFocus();

    await user.tab();

    expect(deleteButton).not.toHaveFocus();
  });
});

describe("Escape clears the selection before the row cursor", () => {
  function checkbox(denomination) {
    return screen.getByRole("checkbox", { name: `Select ${denomination}` });
  }

  function selectionBar() {
    return screen.queryByRole("region", { name: "Selection actions" });
  }

  beforeEach(() => {
    getNotes.mockResolvedValue({ notes: threeNotes });
  });

  test("Escape on a selected row clears the selection and keeps the cursor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = (await screen.findByText("AAAA")).closest("tr");

    row.focus();
    await user.keyboard(" ");

    expect(checkbox("AAAA")).toBeChecked();
    expect(selectionBar()).toBeInTheDocument();
    expect(row).toHaveClass("table-row-link--active");

    await user.keyboard("{Escape}");

    expect(checkbox("AAAA")).not.toBeChecked();
    expect(selectionBar()).not.toBeInTheDocument();
    expect(row).toHaveFocus();
    expect(row).toHaveClass("table-row-link--active");

    // The cursor is still a level below the selection: a second Escape
    // sends it to the anchor, exactly as it did before.
    await user.keyboard("{Escape}");

    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    await waitFor(() => {
      expect(row).not.toHaveClass("table-row-link--active");
    });
  });

  test("a mouse-only selection drops focus on Escape and the next Down repaints the last row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const rowA = (await screen.findByText("AAAA")).closest("tr");
    const rowB = (await screen.findByText("BBBB")).closest("tr");

    // Pointer selection focuses the checkbox but paints no row cursor.
    await user.click(checkbox("AAAA"));
    await user.click(checkbox("BBBB"));
    expect(selectionBar()).toBeInTheDocument();
    expect(rowA).not.toHaveClass("table-row-link--active");
    expect(rowB).not.toHaveClass("table-row-link--active");

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    expect(rowA).not.toHaveClass("table-row-link--active");
    expect(rowB).not.toHaveClass("table-row-link--active");

    await user.keyboard("{ArrowDown}");

    expect(rowB).toHaveFocus();
    expect(rowB).toHaveClass("table-row-link--active");
    expect(rowA).not.toHaveClass("table-row-link--active");
  });

  test("Escape in the bar after a mouse-only selection resumes on the last row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");
    const rowB = (await screen.findByText("BBBB")).closest("tr");

    await user.click(checkbox("AAAA"));
    await user.click(checkbox("BBBB"));

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    await user.tab();
    expect(
      within(bar).getByRole("button", {
        name: "Move 2 selected notes down",
      }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
    expect(rowB).not.toHaveClass("table-row-link--active");

    await user.keyboard("{ArrowDown}");

    expect(rowB).toHaveFocus();
    expect(rowB).toHaveClass("table-row-link--active");
  });

  test("Escape on the table anchor clears the selection", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");

    await user.click(checkbox("AAAA"));
    expect(selectionBar()).toBeInTheDocument();

    const anchor = container.querySelector(".table-focus-anchor");
    act(() => {
      anchor.focus();
    });

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(checkbox("AAAA")).not.toBeChecked();
    expect(anchor).toHaveFocus();
  });

  test("Escape after clicking above the table clears the selection", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    const row = (await screen.findByText("AAAA")).closest("tr");
    await screen.findByText("BBBB");

    await user.click(checkbox("AAAA"));
    expect(selectionBar()).toBeInTheDocument();

    // Clicking the page chrome above the table leaves focus on <body>, not
    // in the table. Escape must still clear the selection from there.
    await user.click(screen.getByRole("heading", { name: "Test" }));
    expect(document.body).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(checkbox("AAAA")).not.toBeChecked();
    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();

    // The pointer's last row is remembered, so the keyboard resumes there.
    await user.keyboard("{ArrowDown}");

    expect(row).toHaveFocus();
    expect(row).toHaveClass("table-row-link--active");
  });

  test("Escape from a control above the table clears the selection", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");

    await user.click(checkbox("AAAA"));
    expect(selectionBar()).toBeInTheDocument();

    const columnsButton = await screen.findByRole("button", {
      name: /Columns/,
    });
    columnsButton.focus();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(checkbox("AAAA")).not.toBeChecked();
    expect(columnsButton).toHaveFocus();
    expect(container.querySelector(".table-focus-anchor")).not.toHaveFocus();
  });

  test("Escape in the search field keeps the selection", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(checkbox("AAAA"));

    const search = screen.getByRole("searchbox", { name: "Filter Catalog" });
    await user.type(search, "AAA");
    await user.keyboard("{Escape}");

    expect(search).not.toHaveFocus();
    expect(selectionBar()).toBeInTheDocument();
    expect(checkbox("AAAA")).toBeChecked();
  });

  test("Tab after clearing the selection enters the row's checkbox", async () => {
    const user = userEvent.setup();
    renderTable();
    const row = (await screen.findByText("AAAA")).closest("tr");

    row.focus();
    await user.keyboard(" ");
    expect(checkbox("AAAA")).toBeChecked();

    await user.keyboard("{Escape}");
    expect(selectionBar()).not.toBeInTheDocument();
    expect(row).toHaveFocus();

    await user.tab();

    expect(checkbox("AAAA")).toHaveFocus();
  });

  test("Escape in the bar clears the selection and returns to the cursor row", async () => {
    const user = userEvent.setup();
    renderTable();
    const row = (await screen.findByText("AAAA")).closest("tr");

    row.focus();
    await user.keyboard(" ");

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    const moveDown = within(bar).getByRole("button", {
      name: "Move 1 selected note down",
    });

    await user.tab();
    expect(moveDown).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(row).toHaveFocus();
    expect(row).toHaveClass("table-row-link--active");
    expect(checkbox("AAAA")).not.toBeChecked();
  });

  test("Escape in the bar without a cursor returns to the table anchor", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await user.click(
      await screen.findByRole("checkbox", { name: "Select all visible rows" }),
    );

    const bar = await screen.findByRole("region", {
      name: "Selection actions",
    });
    await user.tab();
    expect(
      within(bar).getByRole("button", {
        name: "Tags…",
      }),
    ).toHaveFocus();
    await user.tab();
    expect(
      within(bar).getByRole("button", {
        name: "Delete",
      }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(container.querySelector(".table-focus-anchor")).toHaveFocus();
  });

  test("Escape on select-all clears the selection before leaving the header", async () => {
    const user = userEvent.setup();
    renderTable();
    const selectAll = await screen.findByRole("checkbox", {
      name: "Select all visible rows",
    });
    const firstRow = (await screen.findByText("AAAA")).closest("tr");

    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(selectionBar()).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(selectAll).not.toBeChecked();
    expect(selectAll).toHaveFocus();

    // With the selection gone the header's own Escape takes over again.
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(firstRow).toHaveFocus();
    });
  });

  test("the actions menu closes before the selection clears", async () => {
    const user = userEvent.setup();
    renderTable();
    const row = (await screen.findByText("AAAA")).closest("tr");

    row.focus();
    await user.keyboard(" ");

    const actionsButton = screen.getByRole("button", {
      name: "Actions for AAAA",
    });
    actionsButton.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("menu", { name: "Actions for AAAA" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(actionsButton).toHaveFocus();
    expect(checkbox("AAAA")).toBeChecked();
    expect(selectionBar()).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(selectionBar()).not.toBeInTheDocument();
    expect(checkbox("AAAA")).not.toBeChecked();
    expect(actionsButton).toHaveFocus();
    expect(row).toHaveClass("table-row-link--active");
  });
});
