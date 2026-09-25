import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
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

function pointerEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function renderTable() {
  return render(
    <MemoryRouter>
      <NotesTable
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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
        url: null,
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

describe("NotesTable column panning", () => {
  test("dragging a row pans the table instead of selecting text", async () => {
    const { container } = renderTable();

    const cell = await screen.findByText("ZZTEST");
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

    cell.dispatchEvent(
      pointerEvent("pointerdown", {
        button: 0,
        clientX: 900,
        clientY: 300,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
    cell.dispatchEvent(
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

    cell.dispatchEvent(
      pointerEvent("pointerup", {
        button: 0,
        clientX: 800,
        clientY: 300,
        pointerId: 7,
        pointerType: "mouse",
      }),
    );
  });
});
