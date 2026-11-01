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
    grading_company: "PMG",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "BBBB",
    catalog_number: "Fr. 500",
    grading_company: "PCGS",
    serial: "SER-2",
  }),
  note(3, {
    denomination: "CCCC",
    catalog_number: "Fr. 2300",
    grading_company: "PMG",
    serial: "SER-3",
  }),
];

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

function filtersToggle() {
  return screen.findByRole("button", { name: /^Filters/ });
}

async function openFilters() {
  const user = userEvent.setup();
  await user.click(await filtersToggle());
  return user;
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

describe("NotesTable filters", () => {
  test("the table opens without the filter row", async () => {
    renderTable();

    await screen.findByText("AAAA");

    expect(
      screen.queryByLabelText("Filter Denomination"),
    ).not.toBeInTheDocument();
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("the Filters control reveals the filter row", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    const filter = await screen.findByLabelText("Filter Denomination");
    expect(filter).toBeVisible();
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "true");

    await user.click(await filtersToggle());

    expect(
      screen.queryByLabelText("Filter Denomination"),
    ).not.toBeInTheDocument();
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("typing a filter updates the badge and shows a removable chip", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");

    const toggle = await screen.findByRole("button", {
      name: "Filters (1 active)",
    });
    expect(within(toggle).getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Company filter" }),
    ).toBeInTheDocument();
  });

  test("a tags filter counts once and reads as one chip", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    const tags = await screen.findByLabelText("Filter Tags");
    await user.type(tags, "Silver Certificate{Enter}");
    expect(
      await screen.findByRole("button", { name: "Filters (1 active)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tags: Silver Certificate")).toBeInTheDocument();

    await user.type(
      await screen.findByLabelText("Filter Tags"),
      "Star Note{Enter}",
    );

    expect(
      screen.getByRole("button", { name: "Filters (1 active)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Tags: Silver Certificate, Star Note"),
    ).toBeInTheDocument();
  });

  test("the filter row stays open after closing the toggle while a filter has a value", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    const company = await screen.findByLabelText("Filter Company");
    await user.type(company, "PMG");

    await user.click(await filtersToggle());

    const stillOpen = await screen.findByLabelText("Filter Company");
    expect(stillOpen).toHaveValue("PMG");
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();
  });

  test("clicking Filters while a filter forces the row open is a no-op", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    const toggle = await filtersToggle();

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute(
      "title",
      "Filters stay open while any filter is active",
    );

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Clearing the forcing filter leaves the row open: the click above did
    // not flip the collector's open/closed intent behind the scenes.
    await user.click(
      screen.getByRole("button", { name: "Remove Company filter" }),
    );
    expect(await screen.findByLabelText("Filter Company")).toBeInTheDocument();
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "true");
  });

  test("removing a chip clears that column filter", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Remove Company filter" }),
    );

    expect(await screen.findByLabelText("Filter Company")).toHaveValue("");
    expect(screen.queryByText("Company: PMG")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /active\)/ }),
    ).not.toBeInTheDocument();
    await screen.findByText("BBBB");
  });

  test("Clear all is available as soon as one filter is active", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(await screen.findByLabelText("Filter Company")).toHaveValue("");
    expect(screen.queryByText("Company: PMG")).not.toBeInTheDocument();
    await screen.findByText("BBBB");
  });

  test("Clear all clears every column filter", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    await user.type(await screen.findByLabelText("Filter Serial"), "SER-3");
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();
    expect(screen.getByText("Serial: SER-3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear all" }));

    expect(await screen.findByLabelText("Filter Company")).toHaveValue("");
    expect(screen.getByLabelText("Filter Serial")).toHaveValue("");
    expect(screen.queryByText("Company: PMG")).not.toBeInTheDocument();
    expect(screen.queryByText("Serial: SER-3")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /active\)/ }),
    ).not.toBeInTheDocument();
    await screen.findByText("BBBB");
  });

  test("Escape after clicking above the table clears the filters", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();

    // Clicking the page chrome above the table leaves focus on <body>.
    await user.click(screen.getByRole("heading", { name: "Test" }));
    expect(document.body).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Company: PMG")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /active\)/ }),
    ).not.toBeInTheDocument();
    await screen.findByText("BBBB");
  });

  test("Escape on a header sort control keeps the filters", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");

    const sort = screen.getByRole("button", { name: "DENOMINATION" });
    sort.focus();
    await user.keyboard("{Escape}");

    expect(sort).toHaveFocus();
    expect(screen.getByText("Company: PMG")).toBeInTheDocument();
  });

  test("the filter inputs tab in column order", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.click(await screen.findByLabelText("Filter Catalog #"));

    for (const label of [
      "Filter Denomination",
      "Filter Date",
      "Filter Company",
      "Filter Grade",
      "Filter Serial",
      "Filter Tags",
    ]) {
      await user.tab();
      expect(screen.getByLabelText(label)).toHaveFocus();
    }
  });

  test("the / key focuses search, not a column filter", async () => {
    renderTable();

    await screen.findByText("AAAA");
    await openFilters();
    const search = screen.getByRole("searchbox", { name: "Search notes" });

    await userEvent.setup().keyboard("/");

    expect(search).toHaveFocus();
  });

  test("Reset filters closes the row once the filters are cleared", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();

    await user.type(await screen.findByLabelText("Filter Company"), "PMG");
    await user.click(
      screen.getByRole("button", {
        name: "Reset view",
      }),
    );

    expect(
      screen.queryByLabelText("Filter Company"),
    ).not.toBeInTheDocument();
    expect(await filtersToggle()).toHaveAttribute("aria-expanded", "false");
    await screen.findByText("BBBB");
  });

  test("filters are never written to saved table state", async () => {
    renderTable();

    await screen.findByText("AAAA");
    const user = await openFilters();
    await user.type(await screen.findByLabelText("Filter Company"), "PMG");

    await waitFor(() => {
      expect(screen.queryByText("BBBB")).not.toBeInTheDocument();
    });

    // Filtering alone is not a structural change, so nothing is saved yet.
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();

    // A structural change saves the payload, and it still carries no filters.
    await user.click(screen.getByRole("button", { name: "DENOMINATION" }));

    await waitFor(() => {
      const savedState = JSON.parse(
        window.localStorage.getItem("noteharbor.notesTableState.1"),
      );
      expect(Object.keys(savedState).sort()).toEqual([
        "sortDirection",
        "sortKey",
        "visibleColumnKeys",
      ]);
    });
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).not.toContain("PMG");
  });

  test("a saved filter does not come back on a reload", async () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        filters: { grading_company: "PMG" },
        sortKey: "id",
        sortDirection: "asc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );

    renderTable();

    await screen.findByText("AAAA");
    expect(screen.getByText("BBBB")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter Company")).not.toBeInTheDocument();
  });
});
