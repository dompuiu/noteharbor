import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
}));

const scrollToOffsetMock = vi.fn();

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
    scrollToOffset: (...args) => scrollToOffsetMock(...args),
  }),
}));

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function notePayload(id, collectionId) {
  return {
    id,
    display_order: 1,
    denomination: `C${collectionId}-N${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  getNotes.mockImplementation((collectionId) =>
    Promise.resolve({ notes: [notePayload(collectionId * 100 + 1, collectionId)] }),
  );
});

describe("NotesTable collection switch scroll reset", () => {
  test("switching collections resets horizontal and vertical scroll to the start", async () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <NotesTable
          collection={{ id: 1, is_default: 1, name: "First" }}
          collectionId={1}
          collections={[
            { id: 1, is_default: 1, name: "First" },
            { id: 2, is_default: 0, name: "Second" },
          ]}
          collectionsError=""
          loadingCollections={false}
        />
      </MemoryRouter>,
    );

    await screen.findByText("C1-N101");

    const xScroller = container.querySelector(".table-scroll-x");
    const yScroller = container.querySelector(".table-scroll-y");
    expect(xScroller).not.toBeNull();
    expect(yScroller).not.toBeNull();

    // Simulate the user having panned right and scrolled down in the first
    // collection.
    xScroller.scrollLeft = 400;
    yScroller.scrollTop = 200;
    expect(xScroller.scrollLeft).toBe(400);
    expect(yScroller.scrollTop).toBe(200);

    scrollToOffsetMock.mockClear();

    rerender(
      <MemoryRouter>
        <NotesTable
          collection={{ id: 2, is_default: 0, name: "Second" }}
          collectionId={2}
          collections={[
            { id: 1, is_default: 1, name: "First" },
            { id: 2, is_default: 0, name: "Second" },
          ]}
          collectionsError=""
          loadingCollections={false}
        />
      </MemoryRouter>,
    );

    await screen.findByText("C2-N201");

    await waitFor(() => {
      const nextX = container.querySelector(".table-scroll-x");
      const nextY = container.querySelector(".table-scroll-y");
      expect(nextX?.scrollLeft).toBe(0);
      expect(nextY?.scrollTop).toBe(0);
    });

    // The virtualized rows render through the vertical scroller, so its
    // offset has to reset too — otherwise the new collection opens
    // part-way down its rows.
    expect(scrollToOffsetMock).toHaveBeenCalledWith(0);
  });
});
