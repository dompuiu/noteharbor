import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
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

import {
  getNotes,
} from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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

function renderTable(editCollectionTo = null) {
  return render(
    <MemoryRouter>
      <NotesTable
        activeCollection={{ id: 1, is_default: 1, name: "Test" }}
        activeCollectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        editCollectionTo={editCollectionTo}
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("NotesTable header controls", () => {
  test("keeps the collection selector and Add note above the table", async () => {
    renderTable();

    const select = await screen.findByLabelText("Active collection");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
  });

  test("no longer shows the Import / Export link", async () => {
    renderTable();

    await screen.findByLabelText("Active collection");

    expect(
      screen.queryByRole("link", { name: "Import or export" }),
    ).not.toBeInTheDocument();
  });

  test("shows no Edit link without an edit destination", async () => {
    renderTable();

    await screen.findByLabelText("Active collection");

    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  });

  test("shows the Edit link next to Add note when given an edit destination", async () => {
    renderTable("/catalog/collections/1/edit");

    await screen.findByLabelText("Active collection");

    const edit = screen.getByRole("link", { name: "Edit" });
    expect(edit).toHaveAttribute("href", "/catalog/collections/1/edit");

    const actions = edit.closest(".inline-actions");
    const labels = Array.from(
      actions.querySelectorAll(":scope > a, :scope > button"),
      (element) => element.textContent,
    );
    expect(labels).toEqual(["Edit", "Add note", "Shortcuts"]);
  });
});

describe("NotesTable header emphasis", () => {
  test("sort button labels render uppercase in markup", async () => {
    const { container } = renderTable();

    await screen.findByLabelText("Move AAAA");

    const labels = Array.from(
      container.querySelectorAll("thead tr:first-child .sort-button"),
    ).map((button) =>
      button.textContent.replace(/[▲▼]/g, "").trim(),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label).toBe(label.toUpperCase());
    }
    expect(labels).toContain("DENOMINATION");
  });
  test("only the sorted column carries the active sort class", async () => {
    renderTable();
    const user = userEvent.setup();

    const idButton = await screen.findByRole("button", { name: /^ID/ });
    const denominationButton = screen.getByRole("button", {
      name: /DENOMINATION/,
    });
    expect(idButton.classList.contains("sort-button--active")).toBe(true);
    expect(
      denominationButton.classList.contains("sort-button--active"),
    ).toBe(false);

    await user.click(denominationButton);

    expect(idButton.classList.contains("sort-button--active")).toBe(false);
    expect(
      denominationButton.classList.contains("sort-button--active"),
    ).toBe(true);
  });

  test("a column filter with a value carries the active filter class", async () => {
    renderTable();
    const user = userEvent.setup();

    const denominationFilter = await screen.findByLabelText(
      "Filter Denomination",
    );
    expect(
      denominationFilter.classList.contains("filter-input--active"),
    ).toBe(false);

    await user.type(denominationFilter, "AA");

    expect(
      denominationFilter.classList.contains("filter-input--active"),
    ).toBe(true);

    await user.clear(denominationFilter);

    expect(
      denominationFilter.classList.contains("filter-input--active"),
    ).toBe(false);
  });
});
