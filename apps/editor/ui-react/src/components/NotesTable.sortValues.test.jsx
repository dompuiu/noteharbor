import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getTags: vi.fn(),
  reorderNotes: vi.fn(),
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

import { getNotes, getTags } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, fields) {
  return {
    id,
    display_order: id,
    denomination: `Note ${id}`,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...fields,
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

function columnValues(container, columnKey) {
  return Array.from(
    container.querySelectorAll(`tbody td.table-col-${columnKey}`),
  ).map((cell) => cell.textContent.trim());
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
  getTags.mockResolvedValue({ tags: [] });
});

describe("NotesTable orders a column by its value, not by its text", () => {
  test("Date sorts chronologically across mixed date formats", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "Year only", issue_date: "1917" }),
        note(2, { denomination: "Oldest", issue_date: "07/12/1877" }),
        note(3, { denomination: "Latest", issue_date: "12/21/1938" }),
        note(4, { denomination: "No date", issue_date: "" }),
      ],
    });

    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("Oldest");

    await user.click(await screen.findByRole("button", { name: "Date" }));

    await waitFor(() => {
      // `07/12/1877` sorts as text after `1917` and `12/21/1938`, which is
      // how the column used to read.
      expect(columnValues(container, "denomination")).toEqual([
        "Oldest",
        "Year only",
        "Latest",
        "No date",
      ]);
    });
  });

  test("an unreadable date stays at the end in both directions", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "Year only", issue_date: "1917" }),
        note(2, { denomination: "Oldest", issue_date: "07/12/1877" }),
        note(3, { denomination: "Latest", issue_date: "12/21/1938" }),
        note(4, { denomination: "No date", issue_date: "" }),
      ],
    });

    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("Oldest");

    const dateButton = await screen.findByRole("button", { name: "Date" });
    await user.click(dateButton);
    await user.click(dateButton);

    await waitFor(() => {
      expect(columnValues(container, "denomination")).toEqual([
        "Latest",
        "Year only",
        "Oldest",
        "No date",
      ]);
    });
  });

  test("Denomination sorts by value across Bani and Lei", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "1,000 Lei" }),
        note(2, { denomination: "25 Bani" }),
        note(3, { denomination: "100 Lei" }),
        note(4, { denomination: "1 Leu" }),
      ],
    });

    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("1,000 Lei");

    await user.click(
      await screen.findByRole("button", { name: "Denomination" }),
    );

    await waitFor(() => {
      expect(columnValues(container, "denomination")).toEqual([
        "25 Bani",
        "1 Leu",
        "100 Lei",
        "1,000 Lei",
      ]);
    });
  });

  test("Grade sorts numerically and reads as a graded value", async () => {
    getNotes.mockResolvedValue({
      notes: [
        note(1, { denomination: "A", grade: "66 EPQ" }),
        note(2, { denomination: "B", grade: "30" }),
        note(3, { denomination: "C", grade: "70" }),
        note(4, { denomination: "D", grade: "55" }),
      ],
    });

    const user = userEvent.setup();
    const { container } = renderTable();
    await screen.findByText("A");

    await user.click(await screen.findByRole("button", { name: "Grade" }));

    await waitFor(() => {
      expect(columnValues(container, "grade")).toEqual([
        "30",
        "55",
        "66 EPQ",
        "70",
      ]);
    });

    // The bands are visible while scanning: uncirculated 65+, choice 50–64,
    // circulated below.
    const badges = Array.from(container.querySelectorAll(".table-grade"));
    expect(badges.map((badge) => badge.className)).toEqual([
      expect.stringContaining("table-grade--circulated"),
      expect.stringContaining("table-grade--choice"),
      expect.stringContaining("table-grade--unc"),
      expect.stringContaining("table-grade--unc"),
    ]);
  });
});
