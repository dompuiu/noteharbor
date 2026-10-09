import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/api.js", () => ({
  createShowcase: vi.fn(),
  deleteShowcase: vi.fn(),
  getShowcases: vi.fn(),
  renameShowcase: vi.fn(),
  reorderShowcases: vi.fn(),
}));

import {
  createShowcase,
  getShowcases,
  reorderShowcases,
} from "../lib/api.js";
import { ShowcasesProvider } from "../lib/showcases.jsx";
import { Sidebar } from "./Sidebar.jsx";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  SHOWCASE_ROUTES,
} from "../lib/routes.js";

// The sidebar's static destinations plus one link per loaded showcase. The
// `+ New showcase` row is a button, not a link, so it is asserted separately.
const LINKS = [
  "Banknotes",
  "Collections",
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
      <ShowcasesProvider>
        <Sidebar pageFocusRef={pageFocusRef} />
      </ShowcasesProvider>
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

  // Wait for the data-driven showcase rows before interacting.
  await screen.findByRole("link", { name: "Summer" });
  return { ...view, pageFocusRef };
}

function newShowcaseButton() {
  return screen.getByRole("button", { name: "New showcase" });
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
});

describe("Sidebar navigation groups", () => {
  test("exposes a labelled navigation landmark", async () => {
    await renderSidebar(CATALOG_ROUTES.banknotes);

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  test("renders one link and one icon per destination", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    for (const label of LINKS) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(1);
    }

    // Every link plus the `+ New showcase` action row carries an icon.
    expect(container.querySelectorAll(".sidebar-link .sidebar-ic svg")).toHaveLength(
      LINKS.length + 1,
    );
  });

  test("gives each category a marker icon beside its name", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

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

  test("the first destination is the default route", async () => {
    await renderSidebar(CATALOG_ROUTES.banknotes);

    expect(screen.getByRole("link", { name: LINKS[0] })).toHaveAttribute(
      "href",
      DEFAULT_DESTINATION,
    );
  });

  test("marks the active destination as the current page", async () => {
    await renderSidebar(CATALOG_ROUTES.collections);

    expect(
      screen.getByRole("link", { name: "Collections" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Banknotes" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("keeps Banknotes current while the note editor is open", async () => {
    await renderSidebar(CATALOG_ROUTES.noteEdit(7));

    expect(
      screen.getByRole("link", { name: "Banknotes" }),
    ).toHaveAttribute("aria-current", "page");
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
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(screen.getByRole("link", { name: "Import / Export" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.importExport,
    );
  });

  test("`+ New showcase` creates a showcase and opens its edit route", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(newShowcaseButton());

    expect(createShowcase).toHaveBeenCalled();
    // The click handler creates the showcase, then navigates on the resolved
    // promise; wait for the route rather than assuming it has flushed.
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        SHOWCASE_ROUTES.showcaseEdit(9),
      );
    });
  });

  test("a link click moves focus into the page, off the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(screen.getByRole("link", { name: "Collections" }));

    // The rail is collapsed after the click, so focus belongs in the page.
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("after a link click, an arrow key does not reopen the rail", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    // Reproduces the report: click a destination, then press ↓. Focus is now
    // in the page, so the sidebar must not claim the key and open its cursor.
    await user.click(screen.getByRole("link", { name: "Collections" }));
    await user.keyboard("{ArrowDown}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

describe("Sidebar keyboard cursor", () => {
  test("`b` opens the rail on the active option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.collections);

    await user.keyboard("{b}");

    expect(
      screen
        .getByRole("link", { name: "Collections" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(true);
    expect(document.activeElement).toHaveTextContent("Collections");
  });

  test("`/` is left for the table filter, not the sidebar", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    // `/` stays with the table filter; firing it must not open the rail.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "/" }),
    );

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("j/k and arrows move the cursor between options", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}"); // Banknotes
    await user.keyboard("{j}"); // Collections
    expect(document.activeElement).toHaveTextContent("Collections");

    await user.keyboard("{k}"); // back to Banknotes
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Home and End jump to the ends", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Enter follows the focused option", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}"); // Banknotes
    await user.keyboard("{j}"); // Collections
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.collections,
    );
  });

  test("Escape clears the cursor and returns control to the page", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("navigation"));
  });

  test("Tab off the last option wraps to the first, like ArrowDown", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("New showcase");

    await user.keyboard("{Tab}");

    // Tab stays in the rail and wraps, matching ArrowDown.
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Shift+Tab off the first option wraps to the last, like ArrowUp", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Banknotes");

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("New showcase");
  });

  test("Tab keeps its native order until the cursor is active", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    // No "b": a plain Tab through the rail must not be captured or wrap.
    screen.getByRole("link", { name: "Banknotes" }).focus();
    await user.keyboard("{Tab}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toHaveTextContent("Collections");
  });

  test("`b` does nothing while another control has focus", async () => {
    const user = userEvent.setup();
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

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
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    // The banknote table's rows are focusable <tr>s inside the table shell.
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
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

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
    expect(document.activeElement).toHaveTextContent("Banknotes");
    shell.remove();
  });

  test("Escape returns focus off the rail, not onto a hidden link", async () => {
    const user = userEvent.setup();
    await renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{Escape}");

    expect(document.activeElement).not.toBe(
      screen.getByRole("navigation", { name: "Sections" }),
    );
    expect(
      screen
        .getByRole("link", { name: "Banknotes" })
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

describe("Sidebar showcase reordering", () => {
  test("dropping one showcase onto another hands the provider the new order", async () => {
    reorderShowcases.mockResolvedValue({
      showcases: [
        { id: 2, name: "Vienna" },
        { id: 1, name: "Summer" },
      ],
    });
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    const summer = screen.getByRole("link", { name: "Summer" });
    const vienna = screen.getByRole("link", { name: "Vienna" });
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summer.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      vienna.dispatchEvent(
        dragEvent("dragover", { clientY: 400, dataTransfer }),
      );
    });
    await act(async () => {
      vienna.dispatchEvent(dragEvent("drop", { clientY: 400, dataTransfer }));
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

  test("a drop that lands a showcase back where it started persists nothing", async () => {
    const { container } = await renderSidebar(CATALOG_ROUTES.banknotes);

    const summer = screen.getByRole("link", { name: "Summer" });
    const vienna = screen.getByRole("link", { name: "Vienna" });
    const dataTransfer = makeDataTransfer();

    await act(async () => {
      summer.dispatchEvent(dragEvent("dragstart", { dataTransfer }));
    });
    await act(async () => {
      // A negative clientY is above the (all-zero) rect midpoint, so the
      // placement is "before" — Summer stays immediately ahead of Vienna.
      vienna.dispatchEvent(
        dragEvent("dragover", { clientY: -5, dataTransfer }),
      );
    });
    await act(async () => {
      vienna.dispatchEvent(dragEvent("drop", { clientY: -5, dataTransfer }));
    });

    expect(reorderShowcases).not.toHaveBeenCalled();
    expect(showcaseLabels(container)).toEqual([
      "Summer",
      "Vienna",
      "New showcase",
    ]);
  });
});

