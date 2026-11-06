import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { chooseFilterField } from "../test/filterBar.js";

// A configurable virtualizer: tests that need an off-screen match shrink the
// window, and every scroll request is recorded so the align contract is
// visible.
const virtualizerCalls = { scrollToIndex: vi.fn(), windowed: null };

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => {
      const indices =
        virtualizerCalls.windowed ??
        Array.from({ length: count }, (_, index) => index);

      return indices
        .filter((index) => index < count)
        .map((index) => ({
          index,
          key: index,
          size: 43,
          start: index * 43,
          end: (index + 1) * 43,
        }));
    },
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: (...args) => virtualizerCalls.scrollToIndex(...args),
    scrollToOffset: () => {},
  }),
}));

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
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

const notes = [
  note(1, {
    denomination: "Fr. 2,300 Alpha",
    catalog_number: "Fr. 2300",
    grading_company: "PMG",
    serial: "SER-1",
  }),
  note(2, {
    denomination: "Fr. 500 Beta",
    catalog_number: "Fr. 500",
    grading_company: "PCGS",
    serial: "SER-2",
  }),
  note(3, {
    denomination: "Fr. 2,300 Gamma",
    catalog_number: "Fr. 2300",
    grading_company: "PMG",
    serial: "SER-3",
  }),
  note(4, {
    denomination: "PMG Delta",
    catalog_number: "Fr. 100",
    grading_company: "PMG",
    serial: "HIDDEN-9",
  }),
  note(5, {
    denomination: "Fr. 2,300 Omega",
    catalog_number: "Fr. 2300",
    grading_company: "PCGS",
    serial: "SER-5",
  }),
];

function HashProbe() {
  const location = useLocation();
  return <output data-testid="hash">{location.hash}</output>;
}

function tableProps(overrides = {}) {
  return {
    collection: { id: 1, is_default: 1, name: "Test" },
    collectionId: 1,
    collections: [{ id: 1, is_default: 1, name: "Test" }],
    collectionsError: "",
    loadingCollections: false,
    ...overrides,
  };
}

function renderTable(overrides = {}) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <HashProbe />
      <NotesTable {...tableProps(overrides)} />
    </MemoryRouter>,
  );
}

function rowFor(container, text) {
  return Array.from(container.querySelectorAll("tbody tr.table-row-link")).find(
    (row) => row.textContent.includes(text),
  );
}

function findBar() {
  return screen.getByRole("search", { name: "Find in this view" });
}

function findInput() {
  return screen.getByRole("searchbox", { name: "Find notes in this view" });
}

async function openFind(user) {
  await user.keyboard("{Control>}f{/Control}");

  await waitFor(() => expect(findInput()).toHaveFocus());
  return findInput();
}

async function typeFind(user, value) {
  const input = findInput();
  await user.clear(input);
  await user.type(input, value);
  return input;
}

async function expectFindCount(text) {
  await waitFor(() => {
    expect(within(findBar()).getByText(text)).toBeInTheDocument();
  });
}

async function commitChip(user, label, value) {
  await chooseFilterField(user, label);
  await user.type(
    screen.getByRole("searchbox", { name: `Filter ${label}` }),
    `${value}{Enter}`,
  );
}

function currentFindRow(container) {
  return container.querySelector("tbody tr.table-row-link--find-current");
}

beforeEach(() => {
  vi.clearAllMocks();
  virtualizerCalls.windowed = null;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
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
  getNotes.mockResolvedValue({ notes });
});

describe("NotesTable find", () => {
  test("Ctrl/Cmd+F opens an empty find bar and focuses its input", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);

    expect(findInput()).toHaveValue("");
    expect(within(findBar()).getByText("Type to find")).toBeInTheDocument();
    // An empty query is idle: no marks and no cursor over the rows.
    expect(container.querySelectorAll("tbody mark")).toHaveLength(0);
    expect(currentFindRow(container)).toBeNull();
  });

  test("the rail's Find button opens the bar too", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await user.click(screen.getByRole("button", { name: "Find in this view" }));

    await waitFor(() => expect(findInput()).toHaveFocus());
  });

  test("counts notes, marks every match and tints the current one", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "2300");

    await expectFindCount("1 of 3");
    expect(
      container.querySelector(".table-footer-summary")?.textContent,
    ).toContain("Find 1 of 3");
    // Three matching rows, each marking the term in both the catalog number
    // (literally) and the denomination (as its normalised `2,300` spelling).
    expect(container.querySelectorAll("tbody tr.table-row-link mark")).toHaveLength(
      6,
    );
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Alpha");
    expect(currentFindRow(container)).toHaveAttribute("aria-current", "true");
    // A mounted match is revealed in place, not by asking the virtualizer.
    expect(virtualizerCalls.scrollToIndex).not.toHaveBeenCalled();
  });

  test("Enter and Shift+Enter step and wrap the current match", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    const input = await typeFind(user, "2300");

    await expectFindCount("1 of 3");

    await user.type(input, "{Enter}");
    expect(within(findBar()).getByText("2 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Gamma");

    await user.type(input, "{Enter}");
    expect(within(findBar()).getByText("3 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Omega");

    await user.type(input, "{Enter}");
    expect(within(findBar()).getByText("1 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Alpha");

    await user.type(input, "{Shift>}{Enter}{/Shift}");
    expect(within(findBar()).getByText("3 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Omega");
  });

  test("F3 and Shift+F3 step matches while the input keeps focus", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    const input = await openFind(user);
    await user.type(input, "2300");

    await expectFindCount("1 of 3");

    await user.keyboard("{F3}");
    expect(within(findBar()).getByText("2 of 3")).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Gamma");

    await user.keyboard("{Shift>}{F3}{/Shift}");
    expect(within(findBar()).getByText("1 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Alpha");

    // Both directions wrap.
    await user.keyboard("{Shift>}{F3}{/Shift}");
    expect(within(findBar()).getByText("3 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Omega");

    await user.keyboard("{F3}");
    expect(within(findBar()).getByText("1 of 3")).toBeInTheDocument();
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Alpha");
  });

  test("one match keeps the arrows disabled", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "Omega");

    await expectFindCount("1 of 1");
    expect(
      screen.getByRole("button", { name: "Previous match" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  test("centers a match that is outside the virtualized window", async () => {
    virtualizerCalls.windowed = Array.from({ length: 10 }, (_, index) => index);
    getNotes.mockResolvedValue({
      notes: Array.from({ length: 120 }, (_, index) =>
        note(index + 1, { serial: `SER-${index + 1}` }),
      ),
    });
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("NOTE-1");
    await openFind(user);
    await user.type(findInput(), "SER-100");

    await expectFindCount("1 of 1");
    expect(virtualizerCalls.scrollToIndex).toHaveBeenCalledWith(99, {
      align: "center",
    });
  });

  test("offers to search all notes when filters hide every match", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await commitChip(user, "Company", "PMG");
    await waitFor(() => {
      expect(screen.queryByText("Fr. 500 Beta")).not.toBeInTheDocument();
    });

    await openFind(user);
    await user.type(findInput(), "Omega");

    await waitFor(() => {
      expect(
        within(findBar()).getByText("No matches in this view"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Search all notes" }));

    // The fallback is the only thing find may change: the chip disappears so
    // the kept query can land on the first match.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Edit Company filter PMG" }),
      ).not.toBeInTheDocument();
    });
    expect(findInput()).toHaveValue("Omega");
    await expectFindCount("1 of 1");
  });

  test("says no notes match without filters and offers no fallback", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "nothing-like-this");

    await expectFindCount("No notes match");
    expect(
      container.querySelector(".table-footer-summary")?.textContent,
    ).toContain("Find no matches");
    expect(
      screen.queryByRole("button", { name: "Search all notes" }),
    ).not.toBeInTheDocument();
  });

  test("Esc clears the query and hands focus to the current match row", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    const input = await typeFind(user, "2300");

    await expectFindCount("1 of 3");

    await user.type(input, "{Enter}");
    expect(within(findBar()).getByText("2 of 3")).toBeInTheDocument();

    await user.type(input, "{Escape}");

    expect(screen.queryByRole("search", { name: "Find in this view" })).toBeNull();
    expect(container.querySelectorAll("tbody mark")).toHaveLength(0);
    expect(container.querySelector("tr.table-row-link--find-current")).toBeNull();
    expect(rowFor(container, "Fr. 2,300 Gamma")).toHaveFocus();

    // Reopening starts empty; the closed query is not remembered.
    await openFind(user);
    expect(findInput()).toHaveValue("");
  });

  test("leaves filters, sort, selection and the URL untouched", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await commitChip(user, "Company", "PMG");
    await user.click(screen.getByRole("button", { name: "Denomination" }));
    const hashBefore = screen.getByTestId("hash").textContent;
    const sortedHeader = container.querySelector('th[aria-sort="ascending"]');
    await user.click(
      within(rowFor(container, "Fr. 2,300 Alpha")).getByRole("checkbox"),
    );

    await openFind(user);
    await user.type(findInput(), "2300");

    await expectFindCount("1 of 2");
    expect(
      screen.getByRole("button", { name: "Edit Company filter PMG" }),
    ).toBeInTheDocument();
    expect(container.querySelector('th[aria-sort="ascending"]')).toBe(
      sortedHeader,
    );
    expect(
      within(rowFor(container, "Fr. 2,300 Alpha")).getByRole("checkbox"),
    ).toBeChecked();
    expect(screen.getByTestId("hash").textContent).toBe(hashBefore);
  });

  test("searches only the visible columns", async () => {
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "id",
        sortDirection: "asc",
        visibleColumnKeys: [
          "denomination",
          "issue_date",
          "grading_company",
          "grade",
          "tags",
        ],
      }),
    );
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "HIDDEN-9");

    await expectFindCount("No notes match");
  });

  test("falls back to the first match when filters remove the current one", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "2300");

    await expectFindCount("1 of 3");
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Alpha");

    // SER-3 keeps only the third match, so the stored current note is gone.
    await commitChip(user, "Serial", "SER-3");

    await expectFindCount("1 of 1");
    expect(currentFindRow(container)?.textContent).toContain("Fr. 2,300 Gamma");
  });

  test("ANDs whitespace-split terms like the All-fields filter", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "Fr. 2,300 Alpha");

    await expectFindCount("1 of 1");
  });

  test("a whitespace-only query stays idle", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "   ");

    expect(within(findBar()).getByText("Type to find")).toBeInTheDocument();
    expect(container.querySelectorAll("tbody mark")).toHaveLength(0);
    expect(virtualizerCalls.scrollToIndex).not.toHaveBeenCalled();
  });

  test("does not offer Search all notes when no note matches at all", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await commitChip(user, "Company", "PMG");
    await openFind(user);
    await user.type(findInput(), "nothing-in-this-collection");

    await expectFindCount("No matches in this view");
    expect(
      screen.queryByRole("button", { name: "Search all notes" }),
    ).not.toBeInTheDocument();
  });

  test("merges find marks with the marks already painted by filters", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await commitChip(user, "Company", "PMG");
    await openFind(user);
    await user.type(findInput(), "2300");

    await expectFindCount("1 of 2");
    const marks = Array.from(
      currentFindRow(container).querySelectorAll("mark"),
    ).map((mark) => mark.textContent);
    expect(marks).toContain("PMG");
    expect(marks).toContain("2300");
  });

  test("Meta+F opens find as well", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await user.keyboard("{Meta>}f{/Meta}");

    await waitFor(() => expect(findInput()).toHaveFocus());
  });

  test("does not intercept Ctrl/Cmd+F in the slideshow or a row menu", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await user.click(rowFor(container, "Fr. 2,300 Alpha"));
    await waitFor(() => {
      expect(screen.getByTestId("hash").textContent).toContain("slideshow/1");
    });

    await user.keyboard("{Control>}f{/Control}");
    expect(
      screen.queryByRole("search", { name: "Find in this view" }),
    ).not.toBeInTheDocument();
  });

  test("a row menu keeps Ctrl/Cmd+F to the browser", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await user.click(
      within(rowFor(container, "Fr. 2,300 Alpha")).getByRole("button", {
        name: "Actions for Fr. 2,300 Alpha",
      }),
    );

    await user.keyboard("{Control>}f{/Control}");
    expect(
      screen.queryByRole("search", { name: "Find in this view" }),
    ).not.toBeInTheDocument();
  });

  test("never writes find state to saved table state", async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText("Fr. 2,300 Alpha");
    await openFind(user);
    await user.type(findInput(), "2300");
    await expectFindCount("1 of 3");

    await user.type(findInput(), "{Escape}");

    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();
  });
});
