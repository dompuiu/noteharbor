import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseFilterField } from "../test/filterBar.js";
import {
  noteRowRenderCount,
  noteRowRenders,
  resetNoteRowRenders,
} from "../test/noteRowRenderCounter.jsx";
import { virtualizerStats } from "../test/windowedVirtualizer.js";

// The shared budget harness: a windowed virtualizer (only the rows in the
// viewport render) and a per-commit note-row render counter. The counter wraps
// the real memoized row, so a parent commit that leaves a row's props alone
// does not count it.
vi.mock("@tanstack/react-virtual", async () => {
  const { makeWindowedVirtualizer } = await import(
    "../test/windowedVirtualizer.js"
  );

  return {
    useVirtualizer: makeWindowedVirtualizer({ rowHeight: 46, overscan: 5 }),
  };
});

vi.mock("./NoteRow.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { trackNoteRows } = await import("../test/noteRowRenderCounter.jsx");

  return { NoteRow: trackNoteRows(actual.NoteRow) };
});

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
}));

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const rowHeight = 46;
const viewportHeight = 600;

function note(id, overrides = {}) {
  return {
    id,
    display_order: id,
    denomination: `NOTE-${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...overrides,
  };
}

function manyNotes(count) {
  return Array.from({ length: count }, (_, index) => note(index + 1));
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <NotesTable
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

function scrollerFor(container) {
  const scroller = container.querySelector(".table-scroll-x");
  expect(scroller).not.toBeNull();
  return scroller;
}

function setScrollMetrics(scroller, { height = viewportHeight } = {}) {
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: height,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: height,
  });
  window.dispatchEvent(new Event("resize"));
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

async function scrollBy(scroller, offset) {
  await act(async () => {
    scroller.scrollTop = offset;
    scroller.dispatchEvent(new Event("scroll"));
  });
  await flushFrame();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  virtualizerStats.renders = 0;
  resetNoteRowRenders();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: viewportHeight,
    top: 0,
    left: 0,
    right: 1000,
    bottom: viewportHeight,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});

describe("NotesTable render budget", () => {
  test("typing in the filter field renders zero note rows", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    await chooseFilterField(user, "Denomination");

    resetNoteRowRenders();
    await user.type(
      screen.getByRole("searchbox", { name: "Filter Denomination" }),
      "NOTE-1",
    );

    expect(noteRowRenderCount()).toBe(0);
  });

  test("a scroll tick renders only the rows that entered the window, once", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");

    const scroller = scrollerFor(container);
    setScrollMetrics(scroller);
    await flushFrame();

    resetNoteRowRenders();
    virtualizerStats.renders = 0;

    await scrollBy(scroller, 2 * rowHeight);

    // Two rows scrolled out at the top, two entered at the bottom; the rows
    // that stayed in the window did not re-render.
    expect(noteRowRenderCount()).toBeLessThanOrEqual(2);
    expect(noteRowRenderCount()).toBeGreaterThan(0);
    // One table commit per wheel tick: the custom scrollbar keeps its metrics
    // to itself.
    expect(virtualizerStats.renders).toBe(1);
  });

  test("committing a filter renders each visible row once", async () => {
    getNotes.mockResolvedValue({
      notes: manyNotes(60).map((item, index) => ({
        ...item,
        grading_company: index % 2 === 0 ? "PMG" : "PCGS",
      })),
    });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    await chooseFilterField(user, "Company");
    resetNoteRowRenders();

    await user.type(
      screen.getByRole("searchbox", { name: "Filter Company" }),
      "PMG{Enter}",
    );

    await waitFor(() => {
      expect(
        container.querySelector(".table-footer-summary")?.textContent,
      ).toContain("Showing 30 of 60 notes");
    });

    // Every visible row rendered once; a second commit for the same row set
    // would push the count past the number of rows on screen.
    const visibleRows = container.querySelectorAll(
      "tbody tr.table-row-link",
    ).length;
    expect(noteRowRenderCount()).toBeLessThanOrEqual(visibleRows);
  });

  test("fixed row height keeps the rendered window near 22 rows", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(200) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    const scroller = scrollerFor(container);
    setScrollMetrics(scroller);
    await flushFrame();

    // Land mid-list so both overscan bands are painted.
    await scrollBy(scroller, 80 * rowHeight);

    const rows = container.querySelectorAll("tbody tr.table-row-link").length;
    // 14 rows fit the viewport; the overscan is four above and four below.
    expect(rows).toBeGreaterThanOrEqual(14);
    expect(rows).toBeLessThanOrEqual(22);
  });

  test("a scroll tick creates only the rows that enter the window", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(200) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    const scroller = scrollerFor(container);
    setScrollMetrics(scroller);
    await flushFrame();

    const addedRows = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.matches("tr.table-row-link")) {
            addedRows.push(node);
          }
        }
      }
    });
    observer.observe(container.querySelector("tbody"), {
      childList: true,
      subtree: true,
    });

    await scrollBy(scroller, 2 * rowHeight);
    observer.disconnect();

    // Only the bottom two rows are new DOM; the rest are moved into place by
    // React without creating elements again.
    expect(addedRows.length).toBeLessThanOrEqual(2);
  });

  test("moving the keyboard cursor renders at most two rows", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    resetNoteRowRenders();
    virtualizerStats.measureElementCalls = 0;

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");

    expect(noteRowRenderCount()).toBeLessThanOrEqual(4);
    // Stable row refs mean no detach/attach cycle per commit.
    expect(virtualizerStats.measureElementCalls).toBe(0);
  });

  test("ticking a checkbox renders one row", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    resetNoteRowRenders();

    await user.click(screen.getByRole("checkbox", { name: "Select NOTE-2" }));

    expect(noteRowRenderCount()).toBeLessThanOrEqual(1);
  });

  test("opening a row's actions menu renders one row", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    resetNoteRowRenders();

    await user.click(
      screen.getByRole("button", { name: "Actions for NOTE-1" }),
    );

    expect(
      await screen.findByRole("menu", { name: /NOTE-1/ }),
    ).toBeInTheDocument();
    expect(noteRowRenderCount()).toBeLessThanOrEqual(1);
  });

  test("hovering a thumbnail renders its row only", async () => {
    getNotes.mockResolvedValue({
      notes: manyNotes(60).map((item, index) =>
        index === 0
          ? {
              ...item,
              images: [
                {
                  type: "front",
                  variant: "thumbnail",
                  localPath: "/images/front-thumb.png",
                },
              ],
            }
          : item,
      ),
    });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    const user = userEvent.setup();
    resetNoteRowRenders();

    await user.hover(screen.getByAltText("NOTE-1 front"));

    await waitFor(() => {
      expect(document.querySelector(".table-thumb-preview.is-visible")).not
        .toBeNull();
    });
    // The preview is one table-level bubble, so hovering repaints no rows.
    expect(new Set(noteRowRenders.ids).size).toBeLessThanOrEqual(1);
  });

  test("starting a drag renders the dragged row only", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    resetNoteRowRenders();

    const dataTransfer = {
      effectAllowed: "",
      setData: vi.fn(),
      setDragImage: vi.fn(),
      getData: vi.fn(() => ""),
    };
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer });

    await act(async () => {
      screen.getByLabelText("Move NOTE-1").dispatchEvent(event);
    });

    expect(noteRowRenderCount()).toBeLessThanOrEqual(2);
  });

  test("zebra parity follows the row's list position while scrolling", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    const scroller = scrollerFor(container);
    setScrollMetrics(scroller);
    await flushFrame();

    function rowAt(index) {
      return container.querySelector(`tbody tr[data-index="${index}"]`);
    }

    const before = rowAt(17).classList.contains("table-row-link--zebra");
    await scrollBy(scroller, 2 * rowHeight);
    const after = rowAt(17).classList.contains("table-row-link--zebra");

    expect(after).toBe(before);
    expect(after).toBe(17 % 2 === 1);
    // Every row on screen agrees with its position in the filtered list.
    for (const row of container.querySelectorAll("tbody tr.table-row-link")) {
      const index = Number(row.dataset.index);
      expect(row.classList.contains("table-row-link--zebra")).toBe(
        index % 2 === 1,
      );
    }
  });

  test("the custom scrollbar hides on a short list and tracks a long one", async () => {
    getNotes.mockResolvedValue({ notes: manyNotes(3) });
    const { container, unmount } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    expect(screen.queryByRole("scrollbar")).not.toBeInTheDocument();
    unmount();

    getNotes.mockResolvedValue({ notes: manyNotes(60) });
    const long = renderTable();

    await screen.findByText("NOTE-1");
    const scroller = scrollerFor(long.container);
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: viewportHeight,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      value: 60 * rowHeight,
    });
    window.dispatchEvent(new Event("resize"));
    await flushFrame();

    const scrollbar = await screen.findByRole("scrollbar", {
      name: "Scroll notes table vertically",
    });
    expect(scrollbar).toHaveAttribute("aria-valuenow", "0");

    await scrollBy(scroller, 60 * rowHeight - viewportHeight);

    await waitFor(() => {
      expect(screen.getByRole("scrollbar")).toHaveAttribute(
        "aria-valuenow",
        "100",
      );
    });
  });
});
