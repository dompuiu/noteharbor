import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
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

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, overrides = {}) {
  return {
    id,
    display_order: id,
    denomination: `NOTE-${id}`,
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

const collectionNotes = [
  note(1, {
    denomination: "AAAA",
    catalog_number: "Fr. 2300",
    issue_date: "1928",
    grading_company: "PMG",
    grade: "65",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "BBBB",
    catalog_number: "Fr. 500",
    issue_date: "1934",
    grading_company: "PCGS",
    grade: "64",
    serial: "SER-2",
  }),
];

function renderTable(collectionId = 1) {
  return render(
    <MemoryRouter
      initialEntries={[`/catalog/collections/${collectionId}/view`]}
    >
      <NotesTable
        collection={{ id: collectionId, is_default: 1, name: "Test" }}
        collectionId={collectionId}
        collections={[
          { id: 1, is_default: 1, name: "Test" },
          { id: 2, is_default: 0, name: "Second" },
        ]}
        collectionsError=""
        loadingCollections={false}
      />
    </MemoryRouter>,
  );
}

function columnsButton() {
  return screen.findByRole("button", { name: "Columns" });
}

async function openPicker() {
  const user = userEvent.setup();
  await user.click(await columnsButton());
  const dialog = await screen.findByRole("dialog", {
    name: "Visible columns",
  });
  return { user, dialog };
}

function columnCheckbox(name) {
  return screen.getByRole("checkbox", { name });
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
  getNotes.mockResolvedValue({ notes: collectionNotes });
});

describe("NotesTable columns", () => {
  test("the Columns control opens the hideable columns as checkboxes", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const button = await columnsButton();
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");

    const { user, dialog } = await openPicker();

    expect(button).toHaveAttribute("aria-expanded", "true");
    for (const name of [
      "ID",
      "Denomination",
      "Date",
      "Company",
      "Grade",
      "Serial",
      "Tags",
    ]) {
      expect(within(dialog).getByRole("checkbox", { name })).toBeChecked();
    }

    // Permanent columns are not choices at all.
    for (const name of [
      "Catalog #",
      "FRONT",
      "ACTIONS",
      "Select all visible rows",
    ]) {
      expect(
        within(dialog).queryByRole("checkbox", { name }),
      ).not.toBeInTheDocument();
    }

    await user.click(button);
    expect(
      screen.queryByRole("dialog", { name: "Visible columns" }),
    ).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});
