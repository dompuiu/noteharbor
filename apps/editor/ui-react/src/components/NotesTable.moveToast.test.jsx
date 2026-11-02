import { MemoryRouter } from "react-router-dom";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import {
  noteRowRenderCount,
  resetNoteRowRenders,
} from "../test/noteRowRenderCounter.jsx";
import { virtualizerStats } from "../test/windowedVirtualizer.js";

// The move toast used to be table state, so showing or dismissing it re-rendered
// the whole Table screen. It now owns its message and its timer, and this suite
// keeps it that way: the toast's own lifecycle must not reach the table.
vi.mock("@tanstack/react-virtual", async () => {
  const { makeWindowedVirtualizer } = await import(
    "../test/windowedVirtualizer.js"
  );

  return {
    useVirtualizer: makeWindowedVirtualizer({ rowHeight: 45, overscan: 5 }),
  };
});

vi.mock("./NoteRow.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const { trackNoteRows } = await import("../test/noteRowRenderCounter.jsx");

  return { NoteRow: trackNoteRows(actual.NoteRow) };
});

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  scrapeTimeoutMessage: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [
      { id: 1, is_default: 1, name: "Test" },
      { id: 2, is_default: 0, name: "Other" },
    ],
  }),
}));

import {
  getNote,
  getNotes,
  getTags,
  moveNote,
  updateNote,
} from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Test" },
  { id: 2, is_default: 0, name: "Other" },
];

function note(id, denomination) {
  return {
    id,
    display_order: id,
    denomination,
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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <NotesTable
        collection={collections[0]}
        collectionId={1}
        collections={collections}
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

function setScrollMetrics(scroller, { height = 600 } = {}) {
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

// The move's own renders include a deferred list commit that trails the one
// that drops the note. Wait until the table has stopped committing before
// measuring what the toast's dismissal does.
async function settleTable() {
  let previous = -1;

  while (previous !== virtualizerStats.renders) {
    previous = virtualizerStats.renders;
    await flushFrame();
  }
}

let notesDb;

// The toast clears itself on a four-second timer. Rather than wait it out,
// the test captures that one timeout and fires it: the assertion is about the
// dismissal path, not about wall-clock time. Every other timer passes through.
const realSetTimeout = globalThis.setTimeout;
const dismissTimers = [];
vi.spyOn(globalThis, "setTimeout").mockImplementation(
  (callback, delay, ...args) => {
    if (delay === 4000) {
      dismissTimers.push(callback);
      return 0;
    }

    return realSetTimeout(callback, delay, ...args);
  },
);

beforeEach(() => {
  vi.clearAllMocks();
  dismissTimers.length = 0;
  window.localStorage.clear();
  virtualizerStats.renders = 0;
  resetNoteRowRenders();
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

  notesDb = [note(1, "NOTE-1"), note(2, "NOTE-2"), note(3, "NOTE-3")];
  getNotes.mockImplementation(async () => ({ notes: notesDb }));
  getNote.mockImplementation(async (id) => ({
    note: notesDb.find((entry) => entry.id === id),
  }));
  getTags.mockResolvedValue({ tags: [] });
  updateNote.mockImplementation(async (id, payload) => ({
    note: { ...notesDb.find((entry) => entry.id === id), ...payload },
  }));
  moveNote.mockImplementation(async (id, _from, to) => ({
    note: { ...notesDb.find((entry) => entry.id === id), collection_id: to },
  }));
});

describe("moving a note to another collection", () => {
  test("the toast shows the destination and dismisses without touching the table", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("NOTE-1");
    setScrollMetrics(scrollerFor(container));
    await flushFrame();

    await user.click(
      screen.getByRole("button", { name: "Actions for NOTE-1" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    await screen.findByLabelText("Denomination");

    // The Collection field is the select that starts on this collection.
    const destination = screen.getByDisplayValue("Test");
    await user.selectOptions(destination, "2");
    // A move has to say where the note lands in the destination collection.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Position in collection" }),
      "start",
    );
    await user.click(screen.getByRole("button", { name: "Save & close" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Moved to Other.");

    await settleTable();

    // Dismissal is the toast's own timer, so the table must not commit and no
    // note row may render for it.
    resetNoteRowRenders();
    virtualizerStats.renders = 0;

    expect(dismissTimers).toHaveLength(1);
    act(() => {
      dismissTimers[0]();
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(noteRowRenderCount()).toBe(0);
    expect(virtualizerStats.renders).toBe(0);
  });
});
