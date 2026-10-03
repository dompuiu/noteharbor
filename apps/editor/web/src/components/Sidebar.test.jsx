import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { Sidebar } from "./Sidebar.jsx";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "../lib/routes.js";

const pinStorageKey = "noteharbor.sidebarPinned";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

function renderSidebar(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Sidebar />
    </MemoryRouter>,
  );
}

function drawerToggle() {
  return screen.getByRole("button", { name: "Open navigation" });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("Sidebar navigation groups", () => {
  test("exposes a labelled navigation landmark with both groups", () => {
    renderSidebar(CATALOG_ROUTES.banknotes);

    expect(
      screen.getByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Catalog" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Portfolio" }),
    ).toBeInTheDocument();
  });

  test("renders every Catalog and Portfolio destination", () => {
    renderSidebar(CATALOG_ROUTES.banknotes);

    for (const label of [
      "Banknotes",
      "Collections",
      "Import / Export",
      "Categories",
      "Groupings",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
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
});

describe("Sidebar pin", () => {
  test("toggles and reports its expanded state", async () => {
    const user = userEvent.setup();
    renderSidebar(CATALOG_ROUTES.banknotes);

    const pin = screen.getByRole("button", {
      name: "Keep sidebar expanded",
    });
    expect(pin).toHaveAttribute("aria-expanded", "false");

    await user.click(pin);

    const expandedPin = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    expect(expandedPin).toHaveAttribute("aria-expanded", "true");
  });

  test("persists the pinned state across reloads", async () => {
    const user = userEvent.setup();
    const { unmount } = renderSidebar(CATALOG_ROUTES.banknotes);

    await user.click(
      screen.getByRole("button", { name: "Keep sidebar expanded" }),
    );
    expect(window.localStorage.getItem(pinStorageKey)).toBe("true");

    unmount();
    renderSidebar(CATALOG_ROUTES.banknotes);

    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toHaveAttribute("aria-expanded", "true");
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
