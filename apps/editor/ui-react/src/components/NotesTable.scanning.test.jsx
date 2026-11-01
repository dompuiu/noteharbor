import { MemoryRouter } from "react-router-dom";
import { render, screen, within } from "@testing-library/react";
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
        size: 48,
        start: index * 48,
        end: (index + 1) * 48,
      })),
    getTotalSize: () => count * 48,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, denomination, displayOrder, overrides = {}) {
  return {
    id,
    display_order: displayOrder,
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

function renderTable() {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
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

function headerCell(name) {
  return screen.getByRole("columnheader", { name });
}

function rowFor(denomination) {
  return screen.getByText(denomination).closest("tr");
}

function bodyDenominations(container) {
  return within(container.querySelector("tbody"))
    .getAllByRole("row")
    .map((row) => row.querySelector(".table-col-denomination")?.textContent)
    .filter(Boolean);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
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
  // display_order deliberately differs from id, so sorting by `#` can only
  // pass if the table sorts by display order rather than by id.
  getNotes.mockResolvedValue({
    notes: [
      note(1, "CCCC", 3, { serial: "SER-3", catalog_number: "Fr. 3" }),
      note(2, "AAAA", 1, { serial: "SER-1", catalog_number: "Fr. 1" }),
      note(3, "BBBB", 2, { serial: "SER-2", catalog_number: "Fr. 2" }),
    ],
  });
});

describe("NotesTable scanning", () => {
  test("the # header sorts by display order", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");

    expect(bodyDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);

    await user.click(screen.getByRole("button", { name: "#" }));

    expect(bodyDenominations(container)).toEqual(["CCCC", "BBBB", "AAAA"]);

    await user.click(screen.getByRole("button", { name: "#" }));

    expect(bodyDenominations(container)).toEqual(["AAAA", "BBBB", "CCCC"]);
  });

  test("exposes the sort state through aria-sort, not arrow text", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("AAAA");

    expect(headerCell("#")).toHaveAttribute("aria-sort", "ascending");
    expect(headerCell("Denomination")).toHaveAttribute("aria-sort", "none");

    await user.click(screen.getByRole("button", { name: "Denomination" }));

    expect(headerCell("#")).toHaveAttribute("aria-sort", "none");
    expect(headerCell("Denomination")).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    await user.click(screen.getByRole("button", { name: "Denomination" }));

    expect(headerCell("Denomination")).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    expect(container.querySelector("thead").textContent).not.toMatch(/[▲▼]/);
  });

  test("keeps the active column accent and a decorative chevron", async () => {
    renderTable();
    await screen.findByText("AAAA");

    const orderHeader = headerCell("#");
    const denominationHeader = headerCell("Denomination");
    const chevrons = () => document.querySelectorAll("thead .sort-chevron");

    expect(chevrons()).toHaveLength(1);
    expect(orderHeader.querySelector(".sort-chevron")).not.toBeNull();
    expect(
      within(orderHeader).getByRole("button").classList.contains(
        "sort-button--active",
      ),
    ).toBe(true);
    expect(denominationHeader.querySelector(".sort-chevron")).toBeNull();

    const user = userEvent.setup();
    await user.click(within(denominationHeader).getByRole("button"));

    expect(chevrons()).toHaveLength(1);
    expect(denominationHeader.querySelector(".sort-chevron")).not.toBeNull();
    expect(orderHeader.querySelector(".sort-chevron")).toBeNull();
    expect(
      within(denominationHeader).getByRole("button").classList.contains(
        "sort-button--active",
      ),
    ).toBe(true);
  });

  test("aligns text left and the display order right", async () => {
    const { container } = renderTable();
    await screen.findByText("AAAA");

    expect(headerCell("#")).toHaveClass("align-right");
    expect(headerCell("Serial")).toHaveClass("align-left");
    expect(headerCell("Front")).toHaveClass("align-center");

    const row = rowFor("AAAA");
    const orderCell = within(row).getByText("1");
    expect(orderCell).toHaveClass("align-right");

    expect(within(row).getByText("SER-1")).toHaveClass("align-left");
    expect(row.querySelector(".table-thumb-cell")).toHaveClass("align-center");

    // Every body cell is aligned through the same model metadata.
    for (const cell of container.querySelectorAll("tbody .table-row-link td")) {
      expect(cell.className).toMatch(/\balign-(left|right|center)\b/);
    }
  });
});
