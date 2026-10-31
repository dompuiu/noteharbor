import { MemoryRouter, useLocation } from "react-router-dom";
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

import { deleteNote, getNote, getNotes, getTags } from "../lib/api.js";

let notesDb;

function note(id, denomination, overrides = {}) {
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
    ...overrides,
  };
}

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-hash">{location.hash}</output>;
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <LocationProbe />
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

function currentHash() {
  return screen.getByTestId("route-hash").textContent;
}

function rowFor(denomination) {
  return screen.getByText(denomination).closest("tr");
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
  notesDb = [
    note(1, "AAAA", {
      catalog_number: "Fr. 1",
      url: "https://example.test/aaaa",
    }),
    note(2, "BBBB"),
    note(3, "CCCC"),
  ];
  getNotes.mockImplementation(async () => ({
    notes: notesDb.map((entry) => ({ ...entry })),
  }));
  getNote.mockImplementation(async (id) => ({
    note: { ...notesDb.find((entry) => entry.id === id) },
  }));
  deleteNote.mockImplementation(async (id) => {
    notesDb = notesDb.filter((entry) => entry.id !== id);
  });
  getTags.mockResolvedValue({ tags: [] });
});

describe("NotesTable semantics", () => {
  test("announces body rows as rows, not as buttons", async () => {
    const { container } = renderTable();
    await screen.findByText("AAAA");

    const bodyRows = within(container.querySelector("tbody")).getAllByRole(
      "row",
    );
    expect(bodyRows).toHaveLength(3);

    for (const row of bodyRows) {
      expect(row.tagName).toBe("TR");
      expect(row).not.toHaveAttribute("role");
    }

    // No row is exposed under its text as a button; the only buttons that
    // mention a note are the per-row actions buttons.
    expect(
      screen.queryAllByRole("button", { name: /^(AAAA|BBBB|CCCC)$/ }),
    ).toHaveLength(0);
  });

  test("every header cell is a column header", async () => {
    const { container } = renderTable();
    await screen.findByText("AAAA");

    const headerCells = Array.from(container.querySelectorAll("thead th"));
    expect(headerCells.length).toBeGreaterThan(0);

    for (const cell of headerCells) {
      expect(cell).toHaveAttribute("scope", "col");
    }
  });

  test("the denomination links to the note's source URL, not the note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    const link = screen.getByRole("link", { name: "AAAA" });
    expect(link).toHaveAttribute("href", "https://example.test/aaaa");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");

    // Stop jsdom from attempting the new-tab navigation; the click must still
    // bubble so this proves the row's slideshow handler is suppressed.
    link.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await user.click(link);

    expect(currentHash()).not.toContain("slideshow");
  });

  test("a note without a source URL renders its denomination as text", async () => {
    renderTable();
    await screen.findByText("BBBB");

    expect(
      screen.queryByRole("link", { name: "BBBB" }),
    ).not.toBeInTheDocument();
  });

  test("the source URL stays reachable from the row menu", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(
      screen.getByRole("button", { name: "Actions for AAAA" }),
    );

    const source = await screen.findByRole("menuitem", {
      name: "Open source",
    });
    expect(source).toHaveAttribute("href", "https://example.test/aaaa");
  });

  test("arrow keys still move the row cursor", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    rowFor("AAAA").focus();
    expect(rowFor("AAAA")).toHaveFocus();

    await user.keyboard("{ArrowDown}");

    await waitFor(() => {
      expect(rowFor("BBBB")).toHaveFocus();
    });
    expect(rowFor("BBBB")).toHaveClass("table-row-link--active");
  });

  test("Enter on the focused row still opens the note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    rowFor("AAAA").focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  });

  test("clicking the row still opens the note", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("AAAA");

    await user.click(rowFor("AAAA"));

    await waitFor(() => {
      expect(currentHash()).toContain("slideshow/1");
    });
  });

  test("focus returns to the replacement row after a delete", async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText("BBBB");

    await user.click(
      screen.getByRole("button", { name: "Actions for BBBB" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(rowFor("CCCC")).toHaveFocus();
    });
    expect(rowFor("CCCC")).toHaveClass("table-row-link--active");
  });
});
