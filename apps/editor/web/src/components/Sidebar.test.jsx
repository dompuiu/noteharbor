import { createRef } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { Sidebar } from "./Sidebar.jsx";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "../lib/routes.js";

const LINKS = [
  "Banknotes",
  "Collections",
  "Import / Export",
  "Categories",
  "Groupings",
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

// Mirrors App's shell: the sidebar sits beside a main region whose first
// child is the inert focus anchor that Escape hands focus to.
function renderSidebar(path) {
  const pageFocusRef = createRef();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Sidebar pageFocusRef={pageFocusRef} />
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

  return { ...view, pageFocusRef };
}

function drawerToggle() {
  return screen.getByRole("button", { name: /navigation/ });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Sidebar navigation groups", () => {
  test("exposes a labelled navigation landmark", () => {
    renderSidebar(CATALOG_ROUTES.banknotes);

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
  });

  test("renders one link and one icon per destination", () => {
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    for (const label of LINKS) {
      expect(screen.getAllByRole("link", { name: label })).toHaveLength(1);
    }

    expect(container.querySelectorAll(".sidebar-link .sidebar-ic svg")).toHaveLength(
      LINKS.length,
    );
  });

  test("gives each category a marker icon beside its name", () => {
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

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

    const portfolioLabel = container.querySelector("#sidebar-group-portfolio");
    expect(portfolioLabel).toHaveTextContent("Portfolio");
    expect(portfolioLabel.querySelector(".sidebar-group-ic svg")).not.toBeNull();
  });

  test("marks the active destination as the current page", () => {
    renderSidebar(CATALOG_ROUTES.collections);

    expect(
      screen.getByRole("link", { name: "Collections" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Banknotes" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("keeps Banknotes current while the note editor is open", () => {
    renderSidebar(CATALOG_ROUTES.noteEdit(7));

    expect(
      screen.getByRole("link", { name: "Banknotes" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("highlights a Portfolio destination", () => {
    renderSidebar(PORTFOLIO_ROUTES.categories);

    expect(
      screen.getByRole("link", { name: "Categories" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("links navigate to the prefixed destinations", async () => {
    const user = userEvent.setup();
    renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(screen.getByRole("link", { name: "Import / Export" }));

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.importExport,
    );
  });

  test("a link click moves focus into the page, off the rail", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(screen.getByRole("link", { name: "Collections" }));

    // The rail is collapsed after the click, so focus belongs in the page.
    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("after a link click, an arrow key does not reopen the rail", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

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
    renderSidebar(CATALOG_ROUTES.collections);

    await user.keyboard("{b}");

    expect(
      screen
        .getByRole("link", { name: "Collections" })
        .classList.contains("sidebar-link--cursor"),
    ).toBe(true);
    expect(document.activeElement).toHaveTextContent("Collections");
  });

  test("`/` is left for the table filter, not the sidebar", async () => {
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    // `/` stays with the table filter; firing it must not open the rail.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "/" }),
    );

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
  });

  test("j/k and arrows move the cursor between options", async () => {
    const user = userEvent.setup();
    renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}"); // Banknotes
    await user.keyboard("{j}"); // Collections
    expect(document.activeElement).toHaveTextContent("Collections");

    await user.keyboard("{k}"); // back to Banknotes
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Home and End jump to the ends", async () => {
    const user = userEvent.setup();
    renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("Groupings");

    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Enter follows the focused option", async () => {
    const user = userEvent.setup();
    renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}"); // Banknotes
    await user.keyboard("{j}"); // Collections
    await user.keyboard("{Enter}");

    expect(screen.getByTestId("pathname")).toHaveTextContent(
      CATALOG_ROUTES.collections,
    );
  });

  test("Escape clears the cursor and returns control to the page", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();

    await user.keyboard("{Escape}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByRole("navigation"));
  });

  test("Tab off the last option wraps to the first, like ArrowDown", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveTextContent("Groupings");

    await user.keyboard("{Tab}");

    // Tab stays in the rail and wraps, matching ArrowDown.
    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Banknotes");
  });

  test("Shift+Tab off the first option wraps to the last, like ArrowUp", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.keyboard("{b}");
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveTextContent("Banknotes");

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(container.querySelector(".sidebar-link--cursor")).not.toBeNull();
    expect(document.activeElement).toHaveTextContent("Groupings");
  });

  test("Tab keeps its native order until the cursor is active", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    // No "b": a plain Tab through the rail must not be captured or wrap.
    screen.getByRole("link", { name: "Banknotes" }).focus();
    await user.keyboard("{Tab}");

    expect(container.querySelector(".sidebar-link--cursor")).toBeNull();
    expect(document.activeElement).toHaveTextContent("Collections");
  });

  test("`b` does nothing while another control has focus", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

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
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

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
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

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
    renderSidebar(CATALOG_ROUTES.banknotes);

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
    renderSidebar(CATALOG_ROUTES.importExport);

    await user.keyboard("{b}");
    expect(document.activeElement).toHaveTextContent("Import / Export");

    await user.keyboard("{Escape}");

    expect(document.activeElement).toBe(screen.getByTestId("page-anchor"));
  });
});

describe("Sidebar drawer", () => {
  test("the hamburger opens and closes the drawer", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    const toggle = drawerToggle();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      container.querySelector(".sidebar-dock--drawer-open"),
    ).not.toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      container.querySelector(".sidebar-dock--drawer-open"),
    ).toBeNull();
  });

  test("Escape closes the drawer", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(drawerToggle());
    expect(toggleIsOpen(container)).toBe(true);

    await user.keyboard("{Escape}");

    expect(drawerToggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggleIsOpen(container)).toBe(false);
  });

  test("selecting a destination closes the drawer", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(drawerToggle());
    await user.click(screen.getByRole("link", { name: "Collections" }));

    expect(drawerToggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggleIsOpen(container)).toBe(false);
  });
});

function toggleIsOpen(container) {
  return container.querySelector(".sidebar-dock--drawer-open") !== null;
}
