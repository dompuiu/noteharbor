import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./lib/api.js", () => ({
  getAllNotes: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getNotes: vi.fn(),
  getShowcases: vi.fn(),
}));

import { ShellContent } from "./App.jsx";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import {
  getAllNotes,
  getCollections,
  getHealth,
  getNotes,
  getShowcases,
} from "./lib/api.js";
import { chooseFilterField, filterFieldButton } from "./test/filterBar.js";

const COLLECTIONS = [
  { id: 1, is_default: 1, name: "Serban's Notes" },
  { id: 2, is_default: 0, name: "Vault" },
];

function note(id, collection, overrides = {}) {
  return {
    id,
    collection_id: collection.id,
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
  return screen
    .getAllByRole("link", { name: /^Open / })
    .map((link) => link.textContent);
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
  getShowcases.mockResolvedValue({ showcases: [] });
  getAllNotes.mockResolvedValue({ notes: NOTES });
});

describe("All notes screen", () => {
  test("renders every collection's notes with the collection named on each row", async () => {
    renderAllNotes();

    expect(await screen.findByText("Fr. 2300")).toBeInTheDocument();
    expect(screen.getByText("P-22a")).toBeInTheDocument();
    const firstRow = screen.getByRole("link", { name: /Open Fr\. 2300/ }).closest("tr");
    const secondRow = screen.getByRole("link", { name: /Open P-22a/ }).closest("tr");

    expect(within(firstRow).getByText("Serban's Notes")).toBeInTheDocument();
    expect(within(secondRow).getByText("Vault")).toBeInTheDocument();
    expect(screen.getByText("3 notes across 2 collections")).toBeInTheDocument();
    expect(
      screen.getByText("Showing 3 of 3 notes across 2 collections"),
    ).toBeInTheDocument();
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

  test("the catalog link opens the note in its own collection, and the row is a pointer convenience", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("P-22a");

    expect(
      screen.getByRole("link", { name: "Open P-22a in Vault" }),
    ).toHaveAttribute("href", "/catalog/collections/2/view#slideshow/3");

    await user.click(screen.getByRole("link", { name: "Open P-22a in Vault" }));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/collections/2/view#slideshow/3",
    );
  });

  test("clicking a row opens the note, but a tag click filters the page instead", async () => {
    const user = userEvent.setup();
    renderAllNotes();
    await screen.findByText("Fr. 2300");

    await user.click(screen.getByText("25 Bani"));
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/collections/2/view#slideshow/3",
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
      screen.getByRole("table").querySelector("caption"),
    ).toHaveTextContent("All notes across collections");

    const scroller = container.querySelector(".all-notes-scroll");
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
});
