import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./lib/api.js", () => ({
  getAllNotes: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getNote: vi.fn(),
  getNotes: vi.fn(),
  getShowcases: vi.fn(),
}));

// The All notes table is virtualized now, so the app test needs the same
// windowing stand-in the Table screen's tests use; the real virtualizer sees
// no layout in jsdom and would render no rows.
vi.mock("@tanstack/react-virtual", async () => {
  const { makeWindowedVirtualizer } = await import(
    "./test/windowedVirtualizer.js"
  );

  return { useVirtualizer: makeWindowedVirtualizer({ rowHeight: 45 }) };
});

import { ShellContent } from "./App.jsx";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import {
  getAllNotes,
  getCollections,
  getHealth,
  getNote,
  getNotes,
  getShowcases,
} from "./lib/api.js";
import { allNotesListFields } from "./lib/noteFields.js";
import { chooseFilterField, filterFieldButton } from "./test/filterBar.js";

const COLLECTIONS = [
  { id: 1, is_default: 1, name: "Serban's Notes" },
  { id: 2, is_default: 0, name: "Vault" },
];

function note(id, collection, overrides = {}) {
  return {
    id,
    collection_id: collection.id,
    collection: collection.name,
    collection_name: collection.name,
    collection_order: collection.id === 1 ? 1 : 2,
    display_order: id,
    denomination: `NOTE-${id}`,
    issue_date: "",
    catalog_number: `Cat ${id}`,
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
    ...overrides,
  };
}

const NOTES = [
  note(1, COLLECTIONS[0], {
    catalog_number: "Fr. 2300",
    denomination: "1 Leu",
    issue_date: "05/13/1893",
    grading_company: "PMG",
    grade: "66 EPQ",
    serial: "SER-1",
    tags: [{ id: 1, name: "star" }],
  }),
  note(2, COLLECTIONS[0], {
    catalog_number: "Fr. 500",
    denomination: "100 Lei",
    issue_date: "12/21/1938",
    grading_company: "PCGS",
    grade: "58",
    serial: "SER-2",
  }),
  note(3, COLLECTIONS[1], {
    catalog_number: "P-22a",
    denomination: "25 Bani",
    issue_date: "01/01/1917",
    grading_company: "TQG",
    grade: "40",
    serial: "SER-3",
    tags: [{ id: 2, name: "rare" }],
  }),
];

function LocationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();

  return (
    <>
      <output data-testid="pathname">
        {location.pathname}
        {location.hash}
      </output>
      <output data-testid="search">{location.search}</output>
      <output data-testid="navigation-type">{navigationType}</output>
    </>
  );
}

function renderAllNotes(path = "/catalog/all-notes") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <CollectionsProvider>
        <ShowcasesProvider>
          <ShellContent />
        </ShowcasesProvider>
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

function catalogLinks() {
  return Array.from(document.querySelectorAll("tr.table-row-link")).map(
    (row) =>
      row.querySelector(".table-col-catalog_number")?.textContent.trim() ?? "",
  );
}

async function commitFilter(user, value) {
  await user.type(
    screen.getByRole("searchbox", { name: "Filter All fields" }),
    `${value}{Enter}`,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: String(text).length * 8 }),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({ collections: COLLECTIONS });
  getNotes.mockImplementation(async (collectionId) => ({
    notes: NOTES.filter((entry) => entry.collection_id === collectionId),
  }));
  getNote.mockImplementation(async (id) => ({
    note: NOTES.find((entry) => entry.id === id),
  }));
  getShowcases.mockResolvedValue({ showcases: [] });
  getAllNotes.mockResolvedValue({ notes: NOTES });
});

describe("All notes screen", () => {
  test("renders every collection's notes with the collection named on each row", async () => {
    renderAllNotes();

    expect(await screen.findByText("Fr. 2300")).toBeInTheDocument();
    expect(screen.getByText("P-22a")).toBeInTheDocument();
    const firstRow = screen.getByText("Fr. 2300").closest("tr");
    const secondRow = screen.getByText("P-22a").closest("tr");

    expect(within(firstRow).getByText("Serban's Notes")).toBeInTheDocument();
    expect(within(secondRow).getByText("Vault")).toBeInTheDocument();
    expect(
      screen.queryByText("No notes match these filters."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("3 notes across 2 collections")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 3 of 3 notes across 2 collections"),
    ).toBeInTheDocument();
    // The list asks for the lean projection, not the whole note row.
    expect(getAllNotes).toHaveBeenCalledWith(COLLECTIONS, allNotesListFields);
  });

  test("All fields is the default and finds a note by catalog, serial and tag", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    expect(filterFieldButton()).toHaveTextContent("All fields");
    expect(
      screen.getByRole("searchbox", { name: "Filter All fields" }),
    ).toHaveAttribute("placeholder", "Search every visible field…");

    await commitFilter(user, "P-22a");
    expect(catalogLinks()).toEqual(["P-22a"]);

    await commitFilter(user, "SER-2");
    expect(catalogLinks()).toEqual(["Fr. 500"]);

    await commitFilter(user, "rare");
    expect(catalogLinks()).toEqual(["P-22a"]);
  });

  test("a field chip narrows to one column", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await chooseFilterField(user, "Serial");
    await user.type(
      screen.getByRole("searchbox", { name: "Filter Serial" }),
      "SER-3{Enter}",
    );

    expect(catalogLinks()).toEqual(["P-22a"]);
    expect(screen.getByText("1 of 3 notes across 2 collections")).toBeInTheDocument();
  });

  test("the collection picker narrows and combines with chips, and Clear filters restores everything", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    const picker = screen.getByRole("combobox", { name: "Collection" });
    expect(within(picker).getByRole("option", { name: "All collections (3)" }))
      .toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: "Vault (1)" }))
      .toBeInTheDocument();

    await user.selectOptions(picker, "2");
    expect(catalogLinks()).toEqual(["P-22a"]);
    expect(screen.getByText("1 of 3 notes across 2 collections")).toBeInTheDocument();

    await commitFilter(user, "P-22a");
    expect(catalogLinks()).toEqual(["P-22a"]);

    await user.selectOptions(picker, "1");
    expect(screen.getByText("No notes match these filters.")).toBeInTheDocument();

    await user.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0],
    );
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);
    expect(picker).toHaveValue("");
    expect(
      screen.getByRole("searchbox", { name: "Filter All fields" }),
    ).toHaveValue("");
  });

  test("collection and note headers sort and a third click restores the untouched order", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);

    await user.click(screen.getByRole("button", { name: "Collection" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);

    await user.click(screen.getByRole("button", { name: "Collection" }));
    expect(catalogLinks()).toEqual(["P-22a", "Fr. 2300", "Fr. 500"]);

    await user.click(screen.getByRole("button", { name: "Collection" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);

    await user.click(screen.getByRole("button", { name: "Serial" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);

    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "P-22a", "Fr. 500"]);
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(catalogLinks()).toEqual(["Fr. 500", "P-22a", "Fr. 2300"]);
    await user.click(screen.getByRole("button", { name: "Date" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);
  });

  test("the catalog cell opens the note in the All notes slideshow", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("P-22a");

    await user.click(screen.getByText("P-22a"));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/3",
    );
    // The projected list carries no scraped details, so the slideshow asks for
    // the full note of the row it opens.
    await waitFor(() => {
      expect(getNote).toHaveBeenCalledWith(3, 2);
    });
  });

  test("clicking a row opens the note, but a tag click filters the page instead", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByText("25 Bani"));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/3",
    );
  });

  test("a tag click adds a Tags chip without navigating", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByRole("button", { name: "rare" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes",
    );
    expect(screen.getByTestId("search").textContent).toContain("fc=tags%3Arare");
    expect(catalogLinks()).toEqual(["P-22a"]);
  });

  test("URL state restores the collection, sort and chips, and malformed values fall back", async () => {
    renderAllNotes(
      "/catalog/all-notes?collection=2&sort=serial&dir=desc&fc=tags%3Arare",
    );
    await screen.findByText("P-22a");

    expect(screen.getByRole("combobox", { name: "Collection" })).toHaveValue(
      "2",
    );
    expect(catalogLinks()).toEqual(["P-22a"]);
    expect(screen.getByRole("button", { name: "Serial" }).closest("th"))
      .toHaveAttribute("aria-sort", "descending");
  });

  test("unknown ids and malformed chips fall back without crashing", async () => {
    renderAllNotes(
      "/catalog/all-notes?collection=999&sort=unknown&dir=sideways&fc=%3A%3A%3A",
    );

    expect(await screen.findByText("Fr. 2300")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Collection" })).toHaveValue("");
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);
  });

  test("changing filters replaces the URL entry instead of stacking history", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await commitFilter(user, "P-22a");

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
    expect(screen.getByTestId("search").textContent).toContain("fc=all%3AP-22a");
  });

  test("loading and a failed load both keep the card shape, and Try again recovers", async () => {
    let resolveNotes;
    getAllNotes.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNotes = resolve;
      }),
    );
    renderAllNotes();

    expect(await screen.findByText("Loading notes…")).toBeInTheDocument();
    expect(
      screen.getByText("Reading every collection on this device."),
    ).toBeInTheDocument();

    await act(async () => {
      resolveNotes({ notes: NOTES });
    });

    expect(await screen.findByText("Fr. 2300")).toBeInTheDocument();
  });

  test("a failed load explains itself and offers a retry", async () => {
    getAllNotes.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    renderAllNotes();

    expect(await screen.findByText("Couldn't load notes.")).toBeInTheDocument();
    expect(screen.getByText("network down")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your notes stay on this device and aren't affected.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Fr. 2300")).toBeInTheDocument();
  });

  test("an empty library shows the two ways to add notes", async () => {
    getCollections.mockResolvedValue({ collections: [] });
    renderAllNotes();

    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
    const emptyState = screen.getByText("No notes yet").closest(
      ".table-empty-state",
    );
    expect(
      within(emptyState).getByText(
        "Notes live inside collections. Import a collection or add a note to get started.",
      ),
    ).toBeInTheDocument();
    expect(
      within(emptyState).getByRole("link", { name: "Go to collections" }),
    ).toHaveAttribute("href", "/catalog/collections");
    expect(
      within(emptyState).getByRole("link", { name: "Import / Export" }),
    ).toHaveAttribute("href", "/catalog/import-export");
    expect(getAllNotes).not.toHaveBeenCalled();
  });

  test("no matches names the filters, not an empty library, and clears in one action", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await commitFilter(user, "nothing-matches");

    expect(
      screen.getByText("No notes match these filters."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No note matches every filter in this view."),
    ).toBeInTheDocument();

    const emptyState = screen
      .getByText("No notes match these filters.")
      .closest(".table-empty-state");
    await user.click(
      within(emptyState).getByRole("button", { name: "Clear filters" }),
    );
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);
  });

  test("grade sorts numerically, not as printed text", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByRole("button", { name: "Grade" }));
    expect(catalogLinks()).toEqual(["P-22a", "Fr. 500", "Fr. 2300"]);

    await user.click(screen.getByRole("button", { name: "Grade" }));
    expect(catalogLinks()).toEqual(["Fr. 2300", "Fr. 500", "P-22a"]);
  });

  test("a one-collection library still offers the All collections choice and says so", async () => {
    getCollections.mockResolvedValue({ collections: [COLLECTIONS[0]] });
    getAllNotes.mockResolvedValue({
      notes: NOTES.filter((entry) => entry.collection_id === 1),
    });
    renderAllNotes();

    expect(await screen.findByText("2 notes in 1 collection")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Collection" });
    expect(
      within(picker).getByRole("option", { name: "All collections (2)" }),
    ).toBeInTheDocument();
    expect(
      within(picker).getByRole("option", { name: "Serban's Notes (2)" }),
    ).toBeInTheDocument();
  });

  test("the Collection header is sticky and the active sort is announced", async () => {
    const user = userEvent.setup();
    const { container } = renderAllNotes();
    await screen.findByText("Fr. 2300");

    expect(
      container.querySelector("th.table-col-collection.table-sticky-cell"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Collection" }).closest("th"),
    ).toHaveAttribute("aria-sort", "ascending");

    const scroller = container.querySelector(".table-scroll-x");
    Object.defineProperty(scroller, "scrollLeft", {
      configurable: true,
      value: 40,
    });
    fireEvent.scroll(scroller);
    expect(scroller).toHaveClass("is-scrolled-x");

    await user.click(screen.getByRole("button", { name: "Serial" }));
    expect(
      screen.getByRole("button", { name: "Serial" }).closest("th"),
    ).toHaveAttribute("aria-sort", "ascending");
  });

  test("Ctrl/Cmd+F opens Find over the current view and Esc hands focus back to the match", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.keyboard("{Control>}f{/Control}");
    const input = screen.getByRole("searchbox", {
      name: "Find notes in this view",
    });

    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, "P-22a");

    await waitFor(() => {
      expect(
        within(screen.getByRole("search", { name: "Find in this view" }))
          .getByText("1 of 1"),
      ).toBeInTheDocument();
    });

    await user.type(input, "{Escape}");

    expect(
      screen.queryByRole("search", { name: "Find in this view" }),
    ).toBeNull();
    expect(screen.getByText("P-22a").closest("tr")).toHaveFocus();
  });

  test("the Columns control hides and restores a column, and remembers the choice", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByRole("button", { name: "Columns" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Visible columns",
    });

    await user.click(within(dialog).getByRole("checkbox", { name: "Serial" }));

    expect(
      screen.queryByRole("columnheader", { name: "Serial" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("SER-1")).not.toBeInTheDocument();
    expect(
      JSON.parse(window.localStorage.getItem("noteharbor.allNotesTableState"))
        .visibleColumnKeys,
    ).not.toContain("serial");

    await user.click(within(dialog).getByRole("checkbox", { name: "Serial" }));
    expect(screen.getByText("SER-1")).toBeInTheDocument();
  });

  test("arrow keys focus rows and Enter opens the All notes slideshow", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("Fr. 2300").closest("tr")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("Fr. 500").closest("tr")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/2",
    );
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes",
    );
    await waitFor(() => {
      expect(screen.getByText("Fr. 500").closest("tr")).toHaveFocus();
    });
  });

  test("the slideshow walks the filtered All notes list, not a collection", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Collection" }),
      "2",
    );
    await user.click(screen.getByText("25 Bani"));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/3",
    );
    expect(screen.getByText("1 / 1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close slideshow" }));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes",
    );
    expect(screen.getByTestId("search").textContent).toContain("collection=2");
  });

  test("the image preview opens from the All notes slideshow and Esc steps back", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByText("1 Leu"));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/1",
    );

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/1/preview/front",
    );
    expect(screen.getByText("No preview")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes#slideshow/1",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/all-notes",
    );
  });
});

describe("All notes slideshow modal", () => {
  test("is a named dialog that focuses itself and makes the table inert", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByText("1 Leu"));

    const dialog = screen.getByRole("dialog", { name: "Note slideshow" });
    const screenBody = document.querySelector(
      ".all-notes-screen > .screen-body",
    );

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screenBody).toHaveAttribute("inert");
    await waitFor(() => {
      expect(dialog).toHaveFocus();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        "/catalog/all-notes",
      );
    });
    expect(screenBody).not.toHaveAttribute("inert");
  });
});
