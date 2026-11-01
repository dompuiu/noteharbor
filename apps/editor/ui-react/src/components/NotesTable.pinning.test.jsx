import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
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
      })),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pointerEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function renderTable() {
  return render(
    <MemoryRouter>
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

function armHorizontalOverflow(container) {
  const scroller = container.querySelector(".table-scroll-x");
  expect(scroller).not.toBeNull();

  Object.defineProperty(scroller, "scrollWidth", {
    configurable: true,
    value: 1600,
  });
  Object.defineProperty(scroller, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  scroller.scrollLeft = 0;
  return scroller;
}

function columnGroupWidths(container) {
  return Array.from(
    container.querySelectorAll("table > colgroup > col"),
  ).map((col) => col.style.width);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      // The scroller stands in for a wide window; the table's width follows it
      // (clamped to the 1200px minimum). Other elements keep the old 1000px.
      const width = this.classList?.contains("table-scroll-x") ? 1600 : 1000;

      return {
        width,
        height: 600,
        top: 0,
        left: 0,
        right: width,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  );
  getNotes.mockResolvedValue({
    notes: [
      {
        id: 1,
        display_order: 1,
        denomination: "$1",
        issue_date: "1928",
        catalog_number: "Fr. 2300",
        grading_company: "PMG",
        grade: "65",
        serial: "A00000001A",
        url: null,
        images: [
          {
            type: "front",
            variant: "thumbnail",
            localPath: "/images/front-thumb.png",
          },
        ],
        tags: [],
      },
    ],
  });
});

describe("NotesTable pinned identity columns", () => {
  test("keeps the control widths exact and gives every data column a width", async () => {
    const { container } = renderTable();
    await screen.findByText("Fr. 2300");

    const widths = columnGroupWidths(container);

    // reorder, selection, id, thumbnail
    expect(widths.slice(0, 4)).toEqual(["24px", "44px", "48px", "58px"]);
    expect(
      widths.every((width) => width.endsWith("px") && parseFloat(width) > 0),
    ).toBe(true);
    // Every column, including the scrollbar gutter, adds up to the table width
    // so the browser has no leftover to spread across the fixed columns.
    expect(
      widths.reduce((total, width) => total + parseFloat(width), 0),
    ).toBeCloseTo(1600);
  });

  test("keeps the control widths when tags is hidden", async () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "id",
        sortDirection: "asc",
        visibleColumnKeys: ["id", "denomination", "serial"],
      }),
    );

    const { container } = renderTable();
    await screen.findByText("Fr. 2300");

    expect(columnGroupWidths(container).slice(0, 4)).toEqual([
      "24px",
      "44px",
      "48px",
      "58px",
    ]);
  });

  test("pins the drag cell, selection, display order, thumbnail and catalog at accumulated left offsets", async () => {
    renderTable();
    await screen.findByText("Fr. 2300");

    const reorder = screen.getByLabelText("Move $1").closest("td");
    const selection = screen.getByLabelText("Select $1").closest("td");
    const order = screen.getByRole("cell", { name: "1" }).closest("td");
    const thumbnail = screen.getByAltText("$1 front").closest("td");
    const catalog = screen.getByText("Fr. 2300").closest("td");

    // The stylesheet turns this offset into `left` (plus the pan offset).
    // The drag cell is the row's outer left edge, so it pins at 0 and holds
    // the selection border while the table is panned.
    expect(reorder.style.getPropertyValue("--table-sticky-left")).toBe("0px");
    expect(selection.style.getPropertyValue("--table-sticky-left")).toBe(
      "24px",
    );
    expect(order.style.getPropertyValue("--table-sticky-left")).toBe("68px");
    expect(thumbnail.style.getPropertyValue("--table-sticky-left")).toBe(
      "116px",
    );
    expect(catalog.style.getPropertyValue("--table-sticky-left")).toBe(
      "174px",
    );

    // Only the right-most pinned cell carries the pan-shadow marker.
    expect(catalog.classList.contains("table-sticky-end")).toBe(true);
    expect(order.classList.contains("table-sticky-end")).toBe(false);
    expect(thumbnail.classList.contains("table-sticky-end")).toBe(false);
  });

  test("pins the matching header cells at the same offsets", async () => {
    const { container } = renderTable();
    await screen.findByText("Fr. 2300");

    const reorderHeader = container.querySelector("thead th.drag-cell");
    expect(
      reorderHeader.style.getPropertyValue("--table-sticky-left"),
    ).toBe("0px");
    expect(
      screen.getByText("#").closest("th").style.getPropertyValue(
        "--table-sticky-left",
      ),
    ).toBe("68px");
    expect(
      screen.getByText("FRONT").closest("th").style.getPropertyValue(
        "--table-sticky-left",
      ),
    ).toBe("116px");
    expect(
      screen.getByText("CATALOG #").closest("th").style.getPropertyValue(
        "--table-sticky-left",
      ),
    ).toBe("174px");
  });

  test("shows the pan shadow only while the columns are scrolled", async () => {
    const { container } = renderTable();
    await screen.findByText("Fr. 2300");
    const scroller = armHorizontalOverflow(container);

    expect(scroller.classList.contains("is-scrolled-x")).toBe(false);

    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller.classList.contains("is-scrolled-x")).toBe(true);
    // Pinned alignment is native sticky now, so no per-frame scroll offset is
    // written back to the scroller.
    expect(
      scroller.style.getPropertyValue("--table-sticky-scroll-x"),
    ).toBe("");

    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(scroller.classList.contains("is-scrolled-x")).toBe(false);
  });

  test("keeps the shadow state in sync when the keyboard pans", async () => {
    const { container } = renderTable();
    const user = userEvent.setup();
    await screen.findByText("Fr. 2300");
    const scroller = armHorizontalOverflow(container);

    await user.keyboard("l");
    expect(scroller.scrollLeft).toBe(200);
    expect(scroller.classList.contains("is-scrolled-x")).toBe(true);

    await user.keyboard("h");
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.classList.contains("is-scrolled-x")).toBe(false);
  });

  test("a pinned cell stays a pan surface", async () => {
    const { container } = renderTable();
    const catalog = await screen.findByText("Fr. 2300");
    const scroller = armHorizontalOverflow(container);

    catalog.dispatchEvent(
      pointerEvent("pointerdown", {
        button: 0,
        clientX: 900,
        clientY: 300,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
    catalog.dispatchEvent(
      pointerEvent("pointermove", {
        button: -1,
        clientX: 800,
        clientY: 300,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );

    await waitFor(() => {
      expect(scroller.scrollLeft).toBe(100);
    });
    expect(scroller.classList.contains("is-scrolled-x")).toBe(true);
  });
});
