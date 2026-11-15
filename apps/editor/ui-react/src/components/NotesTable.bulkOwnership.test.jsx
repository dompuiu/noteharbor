import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  reorderNotes: vi.fn(),
  updateNotesOwned: vi.fn(),
  updateNotesTags: vi.fn(),
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

import { getNotes, updateNotesOwned } from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Test" },
  { id: 2, is_default: 0, name: "Other" },
];

let notesDb;

function note(id, denomination, owned = false) {
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
    owned,
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

async function selectRows(user, denominations) {
  await screen.findByText(denominations[0]);

  for (const denomination of denominations) {
    await user.click(
      screen.getByRole("checkbox", { name: `Select ${denomination}` }),
    );
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: text.length * 7 }),
  });
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

  notesDb = [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")];

  getNotes.mockImplementation(async () => ({ notes: [...notesDb] }));
  updateNotesOwned.mockImplementation(async (collectionId, ids, owned) => {
    notesDb = notesDb.map((entry) =>
      ids.includes(entry.id) ? { ...entry, owned } : entry,
    );

    return {
      notes: ids.map((id) => notesDb.find((entry) => entry.id === id)),
    };
  });
});

describe("bulk ownership from the selection bar", () => {
  test("select all then Mark owned writes every selected note", async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(
      await screen.findByRole("checkbox", { name: "Select all visible rows" }),
    );

    const bar = screen.getByRole("region", { name: "Selection actions" });
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Mark owned" }));

    await waitFor(() => {
      expect(updateNotesOwned).toHaveBeenCalledWith(1, [1, 2, 3], true);
    });
    expect(await screen.findByText("Marked 3 notes as owned")).toBeInTheDocument();
    expect(getNotes).toHaveBeenCalledTimes(2);
    expect(notesDb.every((entry) => entry.owned)).toBe(true);
  });

  test("Mark unowned writes only the selected rows, in table order", async () => {
    notesDb = [note(1, "AAAA", true), note(2, "BBBB", true), note(3, "CCCC", true)];
    const user = userEvent.setup();
    renderTable();

    await selectRows(user, ["AAAA", "CCCC"]);

    const bar = screen.getByRole("region", { name: "Selection actions" });
    await user.click(within(bar).getByRole("button", { name: "Mark unowned" }));

    await waitFor(() => {
      expect(updateNotesOwned).toHaveBeenCalledWith(1, [1, 3], false);
    });
    expect(notesDb.map((entry) => entry.owned)).toEqual([false, true, false]);
  });

  test("a failed write keeps the selection and names the failure", async () => {
    updateNotesOwned.mockRejectedValueOnce(
      new Error("Ownership could not be saved."),
    );
    const user = userEvent.setup();
    renderTable();

    await selectRows(user, ["AAAA"]);

    const bar = screen.getByRole("region", { name: "Selection actions" });
    await user.click(within(bar).getByRole("button", { name: "Mark owned" }));

    expect(
      await screen.findByText("Ownership could not be saved."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Selection actions" }),
    ).toBeInTheDocument();
  });
});
