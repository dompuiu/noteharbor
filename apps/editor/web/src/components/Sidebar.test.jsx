import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  deleteShowcase: vi.fn(),
  getCollections: vi.fn(),
  getShowcases: vi.fn(),
  renameShowcase: vi.fn(),
  reorderCollections: vi.fn(),
  reorderShowcases: vi.fn(),
}));

import {
  createCollection,
  createShowcase,
  getCollections,
  getShowcases,
  reorderCollections,
  reorderShowcases,
} from "../lib/api.js";
import { CollectionsProvider } from "../lib/collections.jsx";
import { ShowcasesProvider } from "../lib/showcases.jsx";
import { Sidebar } from "./Sidebar.jsx";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  SHOWCASE_ROUTES,
} from "../lib/routes.js";

// The sidebar's destinations: one link per loaded collection, then
// Import / Export, plus one link per loaded showcase. The `+ New collection`
// and `+ New showcase` rows are buttons, not links, so they are asserted
// separately.
const LINKS = [
  "Default",
  "Archive",
  "Import / Export",
  "Summer",
  "Vienna",
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

// Mirrors App's shell: the sidebar sits beside a main region whose first
// child is the inert focus anchor that Escape hands focus to.
async function renderSidebar(path) {
  const pageFocusRef = createRef();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <CollectionsProvider>
        <ShowcasesProvider>
          <Sidebar pageFocusRef={pageFocusRef} />
        </ShowcasesProvider>
      </CollectionsProvider>
      <main>
        <span
          className="page-focus-anchor"
          data-testid="page-anchor"
          ref={pageFocusRef}
          tabIndex={-1}
        />
      </main>
    </MemoryRouter>,
  );

  // Wait for the data-driven rows before interacting.
  await screen.findByRole("link", { name: "Summer" });
  await screen.findByRole("link", { name: "Default" });
  return { ...view, pageFocusRef };
}

function newShowcaseButton() {
  return screen.getByRole("button", { name: "New showcase" });
}

function newCollectionButton() {
  return screen.getByRole("button", { name: "New collection" });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getShowcases.mockResolvedValue({
    showcases: [
      { id: 1, name: "Summer" },
      { id: 2, name: "Vienna" },
    ],
  });
  createShowcase.mockResolvedValue({
    showcase: { id: 9, name: "Showcase" },
  });
  getCollections.mockResolvedValue({
    collections: [
      { id: 1, is_default: 1, name: "Default", note_count: 2 },
      { id: 2, is_default: 0, name: "Archive", note_count: 0 },
    ],
  });
  createCollection.mockResolvedValue({
    collection: { id: 9, is_default: 0, name: "Collection" },
  });
});

describe("Sidebar navigation groups", () => {
  test("exposes a labelled navigation landmark", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  test("renders one link and one icon per destination", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    for (const label of LINKS) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(1);
    }

    // Every link plus the two create actions carries an icon.
    expect(container.querySelectorAll(".sidebar-link .sidebar-ic svg")).toHaveLength(
      LINKS.length + 2,
    );
    expect(newCollectionButton()).toBeInTheDocument();
    expect(newShowcaseButton()).toBeInTheDocument();
  });

  test("gives each category a marker icon beside its name", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Two section markers, one per category, kept out of the link list so a
    // category never reads as a destination.
    const markers = container.querySelectorAll(
      ".sidebar-group-label .sidebar-group-ic svg",
    );
    expect(markers).toHaveLength(2);
    expect(container.querySelectorAll(".sidebar-link .sidebar-group-ic"))
      .toHaveLength(0);

    const catalogLabel = container.querySelector("#sidebar-group-catalog");
    expect(catalogLabel).toHaveTextContent("Catalog");
    expect(catalogLabel.querySelector(".sidebar-group-ic svg")).not.toBeNull();

    const showcasesLabel = container.querySelector("#sidebar-group-showcases");
    expect(showcasesLabel).toHaveTextContent("Showcases");
    expect(showcasesLabel.querySelector(".sidebar-group-ic svg")).not.toBeNull();
  });

  test("the collections home is the default route", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(1));

    expect(DEFAULT_DESTINATION).toBe(CATALOG_ROUTES.collections);
  });

  test("marks the open collection as the current page", async () => {
    await renderSidebar(CATALOG_ROUTES.collection(2));

    expect(
      screen.getByRole("link", { name: "Archive" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("highlights the open collection in edit mode too", async () => {
    await renderSidebar(CATALOG_ROUTES.collectionEdit(2));

    expect(
      screen.getByRole("link", { name: "Archive" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("marks no collection current while the note editor is open", async () => {
    await renderSidebar(CATALOG_ROUTES.noteEdit(7));

    // The note editor URL names no collection, so no row claims it.
    expect(
      screen.getByRole("link", { name: "Default" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("highlights the open showcase, in view and edit mode", async () => {
    await renderSidebar(SHOWCASE_ROUTES.showcase(2));

    expect(
      screen.getByRole("link", { name: "Vienna" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Summer" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("links navigate to the prefixed destinations", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("link", { name: "Import / Export" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.importExport,
    );
  });

  test("`+ New showcase` stages a draft without posting and opens its edit route", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newShowcaseButton());

    // Deferred creation: nothing POSTs until Save.
    expect(createShowcase).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        SHOWCASE_ROUTES.showcaseEdit("new"),
      );
    });
    // The draft is visible in the sidebar while it is pending.
    expect(screen.getByRole("link", { name: "Showcase" })).toBeInTheDocument();
  });

  test("leaving the draft route discards the pending showcase", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newShowcaseButton());
    await screen.findByRole("link", { name: "Showcase" });

    await user.click(screen.getByRole("link", { name: "Default" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Showcase" })).not.toBeInTheDocument();
    });
    expect(createShowcase).not.toHaveBeenCalled();
  });

  test("a link click moves focus into the page, off the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("link", { name: "Archive" }));

    // The rail is collapsed after the click, so focus belongs in the page.
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("after a link click, an arrow key does not reopen the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Reproduces the report: click a destination, then press ↓. Focus is now
    // in the page, so the sidebar must not claim the key and open its cursor.
    await user.click(screen.getByRole("link", { name: "Archive" }));
    await user.keyboard("{ArrowDown}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

describe("Sidebar keyboard cursor", () => {
  test("`b` opens the rail on the active option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(2));

    await user.keyboard("{b}");

    expect(
      screen
        .getByRole("link", { name: "Archive" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(true);
    expect(document.activeElement).toHaveTextContent("Archive");
  });

  test("`/` is left for the table filter, not the sidebar", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // `/` stays with the table filter; firing it must not open the rail.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "/" }),
    );

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("j/k and arrows move the cursor between options", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default (first collection)
    await user.keyboard("{j}"); // Archive
    expect(document.activeElement).toHaveTextContent("Archive");

    await user.keyboard("{k}"); // back to Default
    expect(document.activeElement).toHaveTextContent("Default");
  });

  test("Home and End jump to the ends", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Default");
  });

  test("Enter follows the focused option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}"); // Default
    await user.keyboard("{j}"); // Archive
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.collection(2),
    );
  });

  test("Escape clears the cursor and returns control to the page", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("navigation"));
  });

  test("Tab off the last option wraps to the first, like ArrowDown", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Tab}");

    // Tab stays in the rail and wraps, matching ArrowDown.
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
  });

  test("Shift+Tab off the first option wraps to the last, like ArrowUp", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Default");

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("New showcase");
  });

  test("Tab keeps its native order until the cursor is active", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // No "b": a plain Tab through the rail must not be captured or wrap.
    screen.getByRole("link", { name: "Default" }).focus();
    await user.keyboard("{Tab}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toHaveTextContent("Archive");
  });

  test("`b` does nothing while another control has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Focus any real control outside the sidebar, then press "b".
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  test("`b` does nothing while a table row has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // The notes table's rows are focusable <tr>s inside the table shell.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML =
      '<table><tbody><tr class="table-row-link" tabindex="0"></tr></tbody></table>';
    document.body.append(shell);
    const row = shell.querySelector("tr");
    row.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(row);
    shell.remove();
  });

  test("`b` opens the rail when focus rests on the table's empty-row anchor", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    // Pressing Escape on a focused row parks focus on an inert anchor inside
    // the table shell. Visually nothing is focused, so "b" must still open
    // the rail exactly as it does on a fresh page load.
    const shell = document.createElement("div");
    shell.className = "table-shell";
    shell.innerHTML = '<span class="table-focus-anchor" tabindex="-1"></span>';
    document.body.append(shell);
    const anchor = shell.querySelector(".table-focus-anchor");
    anchor.focus();

    await user.keyboard("{b}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Default");
    shell.remove();
  });

  test("Escape returns focus off the rail, not onto a hidden link", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.keyboard("{b}");
    await user.keyboard("{Escape}");

    expect(document.activeElement).not.toBe(
      screen.getByRole("navigation", { name: "Sections" }),
    );
    expect(
      screen
        .getByRole("link", { name: "Default" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(false);
  });

  test("Escape hands focus to the page content", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.importExport);

    await user.keyboard("{b}");
    expect(document.activeElement).toHaveTextContent("Import / Export");

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

function dragEvent(type, props) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  return event;
}

function makeDataTransfer() {
  return {
    effectAllowed: "",
    setData: vi.fn(),
    setDragImage: vi.fn(),
    getData: vi.fn(() => ""),
  };
}

function showcaseLabels(container) {
  return Array.from(
    container.querySelectorAll(
      '.sidebar-group[aria-labelledby="sidebar-group-showcases"] .sidebar-link-label',
    ),
    (element) => element.textContent,
  );
}

function collectionLabels(container) {
  return Array.from(
    container.querySelectorAll(
      '.sidebar-group[aria-labelledby="sidebar-group-catalog"] .sidebar-link-label',
    ),
    (element) => element.textContent,
  );
}

describe("Sidebar collection rows", () => {
  test("`+ New collection` stages a draft without posting and opens its edit route", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newCollectionButton());

    // Deferred creation: nothing POSTs until Save.
    expect(createCollection).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        CATALOG_ROUTES.collectionEdit("new"),
      );
    });
    // The draft is visible in the sidebar while it is pending, above Import.
    expect(screen.getByRole("link", { name: "Collection" })).toBeInTheDocument();
    const { container } = { container: document.querySelector(".sidebar-nav") };
    expect(collectionLabels(container)).toEqual([
      "Default",
      "Archive",
      "Collection",
      "New collection",
      "Import / Export",
    ]);
  });

  test("leaving the draft route discards the pending collection", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(newCollectionButton());
    await screen.findByRole("link", { name: "Collection" });

    await user.click(screen.getByRole("link", { name: "Default" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Collection" })).not.toBeInTheDocument();
    });
    expect(createCollection).not.toHaveBeenCalled();
  });
});

describe("Sidebar collection reordering", () => {
  test("rows are plain links until the Catalog reorder toggle is on", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    const toggle = screen.getByRole("button", { name: "Reorder Catalog" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // No grips, no move buttons, nothing draggable before opting in.
    expect(document.querySelectorAll(".sidebar-drag-handle")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Move Default up" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Default" }).getAttribute("draggable"),
    ).toBe("false");

    await user.click(toggle);

    expect(
      screen.getByRole("button", { name: "Done reordering Catalog" }),
    ).toHaveAttribute("aria-pressed", "true");
    // Two collection rows grow grips; the showcase rows stay plain.
    expect(document.querySelectorAll(".sidebar-drag-handle")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Move Default up" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Summer up" }),
    ).not.toBeInTheDocument();
  });

  test("the Showcases toggle only affects showcase rows", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Showcases" }));

    expect(document.querySelectorAll(".sidebar-drag-handle")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Move Summer down" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Default up" }),
    ).not.toBeInTheDocument();
  });

  test("toggling off hides the handles again", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Catalog" }));
    expect(document.querySelectorAll(".sidebar-drag-handle")).toHaveLength(2);

    await user.click(
      screen.getByRole("button", { name: "Done reordering Catalog" }),
    );

    expect(document.querySelectorAll(".sidebar-drag-handle")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Move Default up" }),
    ).not.toBeInTheDocument();
  });

  test("the first row cannot move up and the last cannot move down", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Catalog" }));

    expect(
      screen.getByRole("button", { name: "Move Default up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Archive down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Default down" }),
    ).not.toBeDisabled();
  });

  test("the move buttons hand the provider the swapped order", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Catalog" }));
    await user.click(screen.getByRole("button", { name: "Move Archive up" }));

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(collectionLabels(container)).toEqual([
        "Archive",
        "Default",
        "New collection",
        "Import / Export",
      ]);
    });
  });

  test("dropping one collection onto another hands the provider the new order", async () => {
    const user = userEvent.setup();
    reorderCollections.mockResolvedValue({
      collections: [
        { id: 2, is_default: 0, name: "Archive" },
        { id: 1, is_default: 1, name: "Default" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Catalog" }));

    const defRow = screen
      .getByRole("link", { name: "Default" })
      .closest(".sidebar-row");
    const archiveRow = screen
      .getByRole("link", { name: "Archive" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      defRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      archiveRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      archiveRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    await waitFor(() => {
      expect(reorderCollections).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(collectionLabels(container)).toEqual([
        "Archive",
        "Default",
        "New collection",
        "Import / Export",
      ]);
    });
  });
});

describe("Sidebar showcase reordering", () => {
  test("dropping one showcase onto another hands the provider the new order", async () => {
    const user = userEvent.setup();
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Showcases" }));

    const summerRow = screen
      .getByRole("link", { name: "Summer" })
      .closest(".sidebar-row");
    const viennaRow = screen
      .getByRole("link", { name: "Vienna" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summerRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      viennaRow.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      viennaRow.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
    });

    await waitFor(() => {
      expect(reorderShowcases).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(showcaseLabels(container)).toEqual([
        "Vienna",
        "Summer",
        "New showcase",
      ]);
    });
  });

  test("the move buttons hand the provider the swapped order", async () => {
    const user = userEvent.setup();
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Showcases" }));
    await user.click(screen.getByRole("button", { name: "Move Vienna up" }));

    await waitFor(() => {
      expect(reorderShowcases).toHaveBeenCalledWith([2, 1]);
    });
    await waitFor(() => {
      expect(showcaseLabels(container)).toEqual([
        "Vienna",
        "Summer",
        "New showcase",
      ]);
    });
  });

  test("a drop that lands a showcase back where it started persists nothing", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.collection(1));

    await user.click(screen.getByRole("button", { name: "Reorder Showcases" }));

    const summerRow = screen
      .getByRole("link", { name: "Summer" })
      .closest(".sidebar-row");
    const viennaRow = screen
      .getByRole("link", { name: "Vienna" })
      .closest(".sidebar-row");
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summerRow.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      // A negative clientY is above the (all-zero) rect midpoint, so the
      // placement is "before" — Summer stays immediately ahead of Vienna.
      viennaRow.dispatchEvent(
        dragEvent("dragover", { clientY: -5, dataTransfer }),
      );
    });
    await act(async () => {
      viennaRow.dispatchEvent(dragEvent("drop", { clientY: -5, dataTransfer }));
    });

    expect(reorderShowcases).not.toHaveBeenCalled();
    expect(showcaseLabels(container)).toEqual([
      "Summer",
      "Vienna",
      "New showcase",
    ]);
  });
});

