import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The showcase screenshot tests render the real shell (sidebar + routes) with
// the web API mocked. The other screens are stubbed so assertions land on the
// showcase behaviour, not on their unrelated data loads.
vi.mock("./lib/api.js", () => ({
  createCollection: vi.fn(),
  createShowcase: vi.fn(),
  deleteCollection: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  getShowcases: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
  setDefaultCollection: vi.fn(),
}));

vi.mock("./components/NotesTable.jsx", () => ({
  NotesTable: () => <div>Banknotes screen</div>,
}));

vi.mock("./components/CollectionsScreen.jsx", () => ({
  CollectionsScreen: () => <div>Collections screen</div>,
}));

vi.mock("./components/ImportScreen.jsx", () => ({
  ImportScreen: () => <div>Import and export screen</div>,
}));

vi.mock("./components/NoteEditForm.jsx", () => ({
  NoteEditForm: () => <div>Note editor screen</div>,
}));

import { ShellContent } from "./App.jsx";
import { createShowcase, getCollections, getHealth, getShowcases } from "./lib/api.js";
import { CollectionsProvider } from "./lib/collections.jsx";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "./lib/routes.js";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="pathname">{location.pathname}</output>;
}

function renderAt(path) {
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

function currentPath() {
  return screen.getByTestId("pathname").textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getHealth.mockResolvedValue({ connected: true });
  getCollections.mockResolvedValue({
    collections: [{ id: 1, is_default: 1, name: "Default" }],
  });
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

describe("Showcases sidebar section", () => {
  test("lists one item per showcase and a New showcase action", async () => {
    renderAt(CATALOG_ROUTES.banknotes);

    expect(await screen.findByRole("link", { name: "Summer" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vienna" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New showcase" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showcases")).toBeInTheDocument();
  });

  test("marks the open showcase as the current page, including in edit mode", async () => {
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(2));

    const vienna = await screen.findByRole("link", { name: "Vienna" });
    expect(vienna).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Summer" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("Creating a showcase", () => {
  test("posts a showcase and opens its edit route with the name field focused", async () => {
    const user = userEvent.setup();
    renderAt(CATALOG_ROUTES.banknotes);

    await user.click(
      await screen.findByRole("button", { name: "New showcase" }),
    );

    await waitFor(() => {
      expect(currentPath()).toBe(PORTFOLIO_ROUTES.showcaseEdit(9));
    });
    expect(createShowcase).toHaveBeenCalled();

    const nameField = await screen.findByLabelText("Showcase name");
    await waitFor(() => {
      expect(nameField).toHaveFocus();
    });
  });
});

describe("Showcase modes", () => {
  test("the view route renders the empty-showcase message", async () => {
    renderAt(PORTFOLIO_ROUTES.showcase(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
  });

  test("the edit route renders the empty-showcase message and a name field", async () => {
    renderAt(PORTFOLIO_ROUTES.showcaseEdit(1));

    expect(
      await screen.findByText("This showcase is empty."),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Showcase name"),
    ).toBeInTheDocument();
  });
});

describe("Retired Portfolio routes", () => {
  test("/portfolio/categories falls through to Banknotes", async () => {
    renderAt("/portfolio/categories");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });

  test("/portfolio/groupings falls through to Banknotes", async () => {
    renderAt("/portfolio/groupings");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });
});
