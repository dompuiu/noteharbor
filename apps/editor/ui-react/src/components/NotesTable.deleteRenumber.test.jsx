import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  moveNote: vi.fn(),
  reorderNotes: vi.fn(),
  scrapePreview: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("../lib/collections.jsx", () => ({
  useCollections: () => ({
    collections: [{ id: 1, is_default: 1, name: "Test" }],
  }),
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

import { deleteNote, getNotes, getTags } from "../lib/api.js";

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

function idCells() {
  const checks = screen
    .getAllByRole("checkbox")
    .filter((element) => {
      const label = element.getAttribute("aria-label") || "";
      return label.startsWith("Select ") && label !== "Select all visible rows";
    });

  return checks.map((check) => {
    const cells = check.closest("tr").querySelectorAll("td");
    return cells[2].textContent;
  });
}

beforeEach(() => {
  window.localStorage.clear();
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
    notes: [note(1, "AAAA"), note(2, "BBBB"), note(3, "CCCC")],
  });
  getTags.mockResolvedValue({ tags: [] });
  deleteNote.mockResolvedValue({ success: true });
});

describe("deleting a note renumbers the ID column", () => {
  test("row delete closes the gap", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");
    expect(idCells()).toEqual(["1", "2", "3"]);

    await user.click(screen.getByRole("button", { name: "Delete BBBB" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(idCells()).toEqual(["1", "2"]);
  });

  test("editor delete closes the gap", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    await user.click(screen.getByRole("button", { name: "Edit BBBB" }));
    await screen.findByLabelText("Denomination");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    expect(idCells()).toEqual(["1", "2"]);
  });
});
