import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

// Layout numbers shared by the hoisted virtualizer mock and the assertions.
const { rowHeight, viewportHeight } = vi.hoisted(() => ({
  rowHeight: 45,
  viewportHeight: 600,
}));

// The reveal only matters with real windowing: a moved note outside the
// rendered window has to be scrolled in before it can take focus.
vi.mock("@tanstack/react-virtual", async () => {
  const { makeWindowedVirtualizer } = await import(
    "../test/windowedVirtualizer.js"
  );

  return {
    useVirtualizer: makeWindowedVirtualizer({ rowHeight, overscan: 5 }),
  };
});

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  moveNotes: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
}));

import { getNotes, moveNotes } from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Test" },
  { id: 2, is_default: 0, name: "Other" },
];

function note(id, collectionId, displayOrder) {
  return {
    id,
    display_order: displayOrder,
    denomination: `NOTE-${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    collection_id: collectionId,
  };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The table reads its collection from the route, as CollectionScreen does, so
// a redirect really swaps the notes load the way the app does.
function RoutedTable() {
  const location = useLocation();
  const collectionId = Number(location.pathname.split("/")[3]);
  const collection =
    collections.find((entry) => entry.id === collectionId) ?? collections[0];

  return (
    <NotesTable
      collection={collection}
      collectionId={collection.id}
      collections={collections}
      collectionsError=""
      loadingCollections={false}
    />
  );
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <RoutedTable />
    </MemoryRouter>,
  );
}

function scrollerFor(container) {
  const scroller = container.querySelector(".table-scroll-x");
  expect(scroller).not.toBeNull();
  return scroller;
}

function setScrollMetrics(scroller, contentHeight) {
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: viewportHeight,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: contentHeight,
  });
  window.dispatchEvent(new Event("resize"));
}

async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

let notesByCollection;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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

  notesByCollection = {
    1: Array.from({ length: 40 }, (_, index) =>
      note(index + 1, 1, index + 1),
    ),
    2: Array.from({ length: 30 }, (_, index) =>
      note(101 + index, 2, index + 1),
    ),
  };

  getNotes.mockImplementation(async (collectionId) => ({
    notes: [...(notesByCollection[collectionId] ?? [])],
  }));

  // A move keeps the ids and appends the group to the destination, so the
  // redirected table really has to travel to the bottom to show it.
  moveNotes.mockImplementation(async (ids, from, to) => {
    const moving = notesByCollection[from].filter((note) =>
      ids.includes(note.id),
    );

    notesByCollection[from] = notesByCollection[from].filter(
      (note) => !ids.includes(note.id),
    );
    notesByCollection[to] = [
      ...notesByCollection[to],
      ...moving.map((note, index) => ({
        ...note,
        collection_id: to,
        display_order: notesByCollection[to].length + index + 1,
      })),
    ];

    return moving;
  });
});

describe("arriving in the destination collection after a move", () => {
  test("the moved notes are scrolled into view and the first one takes focus", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("NOTE-1");

    const sourceScroller = scrollerFor(container);
    setScrollMetrics(sourceScroller, notesByCollection[1].length * rowHeight);

    // Move two neighbouring rows to the end of a list that is longer than the
    // window, so the reveal cannot be satisfied without scrolling.
    await user.click(screen.getByRole("checkbox", { name: "Select NOTE-3" }));
    await user.click(screen.getByRole("checkbox", { name: "Select NOTE-4" }));
    await user.click(screen.getByRole("button", { name: "Move to…" }));

    const dialog = await screen.findByRole("dialog", { name: "Move 2 notes" });
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await screen.findByText("NOTE-101");

    const destinationScroller = scrollerFor(container);

    // The fresh table opened at the top, and the moved notes sit at the end
    // of the destination: the reveal has to scroll down to them (a real
    // browser clamps that request to the last screen of rows).
    await waitFor(() => {
      expect(destinationScroller.scrollTop).toBeGreaterThan(0);
    });

    // The mocked virtualizer paints the window on the next scroll tick.
    await act(async () => {
      destinationScroller.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();

    const firstMovedRow = (await screen.findByText("NOTE-3")).closest("tr");
    await waitFor(() => {
      expect(document.activeElement).toBe(firstMovedRow);
    });
    expect(screen.getByText("NOTE-4")).toBeInTheDocument();
  });

  test("a single note from the row menu lands in view and takes focus too", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(
      scrollerFor(container),
      notesByCollection[1].length * rowHeight,
    );

    await user.click(
      screen.getByRole("button", { name: "Actions for NOTE-3" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to…" }));

    const dialog = await screen.findByRole("dialog", { name: "Move note" });
    await user.click(within(dialog).getByRole("button", { name: "Move" }));

    await screen.findByText("NOTE-101");

    const destinationScroller = scrollerFor(container);
    await waitFor(() => {
      expect(destinationScroller.scrollTop).toBeGreaterThan(0);
    });

    await act(async () => {
      destinationScroller.dispatchEvent(new Event("scroll"));
    });
    await flushFrame();

    const movedRow = (await screen.findByText("NOTE-3")).closest("tr");
    await waitFor(() => {
      expect(document.activeElement).toBe(movedRow);
    });
  });
});
