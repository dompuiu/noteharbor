import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Three notes that all answer to "1 Leu" — the shape a real collection has,
// and the reason a denomination is not an identity.
function note(id, catalog, grade, serial, images = []) {
  return {
    id,
    display_order: id,
    denomination: "1 Leu",
    issue_date: "03/12/1915",
    catalog_number: catalog,
    grading_company: "PMG",
    grade,
    serial,
    url: null,
    images,
    tags: [],
  };
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

async function openDeleteFor(user, catalog) {
  const row = screen.getByText(catalog).closest("tr");
  await user.click(within(row).getByRole("button", { name: /Actions for/ }));
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  return screen.findByRole("dialog");
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
    notes: [
      note(1, "M1", "66 EPQ", "F23003895", [
        {
          localPath: "/api/images/notes/1/front-thumbnail.webp",
          type: "front",
          variant: "thumbnail",
        },
      ]),
      note(2, "M2", "65 EPQ", "A.1773 0862"),
      note(3, "M3", "55", "N.983 0026"),
    ],
  });
  getTags.mockResolvedValue({ tags: [] });
  deleteNote.mockResolvedValue({ success: true });
});

describe("a delete confirmation names the note", () => {
  test("the title carries the catalog number, not just the shared denomination", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("M2");

    const dialog = await openDeleteFor(user, "M2");

    expect(
      within(dialog).getByText("Delete M2 · 1 Leu?"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/A\.1773 0862/)).toBeInTheDocument();
    expect(within(dialog).getByText("This cannot be undone.")).toBeInTheDocument();
  });

  test("the dialog shows the note's own picture", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("M1");

    const dialog = await openDeleteFor(user, "M1");

    const thumbnail = dialog.querySelector(".confirm-note-thumb");
    expect(thumbnail).not.toBeNull();
    expect(thumbnail.getAttribute("src")).toContain("front-thumbnail.webp");
  });

  test("a bulk delete lists the notes it is about to remove", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("M1");

    const rowChecks = Array.from(
      container.querySelectorAll('tbody input[type="checkbox"]'),
    );
    for (const check of rowChecks) {
      await user.click(check);
    }

    await user.click(
      screen.getByRole("button", { name: "Delete" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Delete 3 selected notes?"),
    ).toBeInTheDocument();

    // The bar's pill reports progress only once the work starts, so an
    // unanswered confirmation must not read as if the delete already ran.
    const bulkDelete = container.querySelector(".table-bulk-bar-delete");
    expect(bulkDelete).toBeEnabled();
    expect(bulkDelete).toHaveTextContent("Delete");
    expect(screen.queryByRole("button", { name: "Working..." })).toBeNull();

    const listed = Array.from(dialog.querySelectorAll("li")).map((item) =>
      item.textContent,
    );
    expect(listed).toHaveLength(3);
    expect(listed[0]).toContain("M1");
    expect(listed[1]).toContain("M2");
    expect(listed[2]).toContain("M3");
    expect(dialog.textContent).not.toContain("more");
  });
});
