import { MemoryRouter, useLocation } from "react-router-dom";
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

function PathnameProbe() {
  const { pathname } = useLocation();
  return <output data-testid="pathname">{pathname}</output>;
}

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <PathnameProbe />
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
  test("keeps Add note above the table without a collection selector", async () => {
    renderTable();

    await screen.findByRole("button", { name: "Add note" });

    expect(
      screen.queryByLabelText("Active collection"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
  });

  test("no longer shows the Import / Export link", async () => {
    renderTable();

    await screen.findByRole("button", { name: "Add note" });

    expect(
      screen.queryByRole("link", { name: "Import or export" }),
    ).not.toBeInTheDocument();
  });

  test("shows an Edit link to the collection edit route", async () => {
    renderTable();

    await screen.findByRole("button", { name: "Add note" });

    expect(screen.getByRole("link", { name: "Edit Test collection" })).toHaveAttribute(
      "href",
      "/catalog/collections/1/edit",
    );
  });

  test("shows the collection title with no rename control", async () => {
    renderTable();

    await screen.findByRole("button", { name: "Add note" });

    expect(screen.getByRole("heading", { name: "Test" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rename Test collection" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Collection name" }),
    ).not.toBeInTheDocument();
  });

  test("pressing e enters the collection edit mode", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByRole("button", { name: "Add note" });
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/collections/1/view",
    );

    await user.keyboard("e");

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/collections/1/edit",
    );
  });

  test("pressing Escape in edit mode without row focus cancels the edit", async () => {
    const user = userEvent.setup();
    const onCancelCollectionEdit = vi.fn();
    render(
      <MemoryRouter initialEntries={["/catalog/collections/1/edit"]}>
        <NotesTable
          collection={{ id: 1, is_default: 1, name: "Test" }}
          collectionId={1}
          collections={[{ id: 1, is_default: 1, name: "Test" }]}
          collectionsError=""
          loadingCollections={false}
          showEditCollectionAction={false}
          isCollectionEditing
          collectionEditName="Test"
          onCancelCollectionEdit={onCancelCollectionEdit}
        />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Delete collection" });
    await user.keyboard("{Escape}");

    expect(onCancelCollectionEdit).toHaveBeenCalledTimes(1);
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
