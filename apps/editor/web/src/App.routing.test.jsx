import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The routing tests assert where each path lands, not what the screens render,
// so the screens are stubbed out. The collections mock drives the shell's
// connection state and the empty-library state; health is only used on retry.
vi.mock("./lib/api.js", () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollections: vi.fn(),
  getHealth: vi.fn(),
  renameCollection: vi.fn(),
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
import { CollectionsProvider } from "./lib/collections.jsx";
import { getCollections, getHealth } from "./lib/api.js";
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
        <ShellContent />
      </CollectionsProvider>
    </MemoryRouter>,
  );
}

// Mirrors main.jsx, which mounts the app inside StrictMode. StrictMode runs the
// mount effect, its cleanup, then the effect again, which is exactly what used
// to strand the shell in the "Connecting..." state.
function renderAtInStrictMode(path) {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <CollectionsProvider>
          <ShellContent />
        </CollectionsProvider>
      </MemoryRouter>
    </StrictMode>,
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
});

describe("Catalog route prefixes", () => {
  test("serves the banknote table at /catalog/banknotes", async () => {
    renderAt(CATALOG_ROUTES.banknotes);

    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
    expect(currentPath()).toBe("/catalog/banknotes");
  });

  test("serves the collections screen at /catalog/collections", async () => {
    renderAt(CATALOG_ROUTES.collections);

    expect(await screen.findByText("Collections screen")).toBeInTheDocument();
    expect(currentPath()).toBe("/catalog/collections");
  });

  test("serves import and export at /catalog/import-export", async () => {
    renderAt(CATALOG_ROUTES.importExport);

    expect(await screen.findByText("Import and export screen")).toBeInTheDocument();
    expect(currentPath()).toBe("/catalog/import-export");
  });

  test("serves the note editor at /catalog/notes/:id/edit", async () => {
    renderAt(CATALOG_ROUTES.noteEdit(7));

    expect(await screen.findByText("Note editor screen")).toBeInTheDocument();
    expect(currentPath()).toBe("/catalog/notes/7/edit");
  });
});

describe("Root redirect", () => {
  test("/ redirects to /catalog/banknotes", async () => {
    renderAt("/");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });
});

describe("Unknown routes", () => {
  test("an unknown path lands on the first sidebar destination", async () => {
    renderAt("/catalog/banknotes3");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });
});

describe("Portfolio destinations", () => {
  test("serves the categories placeholder at /portfolio/categories", async () => {
    renderAt(PORTFOLIO_ROUTES.categories);

    expect(
      await screen.findByText("Categories are coming soon"),
    ).toBeInTheDocument();
    expect(currentPath()).toBe("/portfolio/categories");
  });

  test("serves the groupings placeholder at /portfolio/groupings", async () => {
    renderAt(PORTFOLIO_ROUTES.groupings);

    expect(
      await screen.findByText("Groupings are coming soon"),
    ).toBeInTheDocument();
    expect(currentPath()).toBe("/portfolio/groupings");
  });

  test("renders the sidebar navigation on every route", async () => {
    renderAt(CATALOG_ROUTES.collections);

    expect(
      await screen.findByRole("navigation", { name: "Sections" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Categories" }),
    ).toBeInTheDocument();
  });
});

describe("Empty library", () => {
  test("an empty library stays on the banknote table", async () => {
    getCollections.mockResolvedValue({ collections: [] });
    renderAt(CATALOG_ROUTES.banknotes);

    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
    expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
  });

  test("the note editor shows the empty-library prompt, not a dead form", async () => {
    getCollections.mockResolvedValue({ collections: [] });
    renderAt(CATALOG_ROUTES.noteEdit(7));

    expect(await screen.findByText(/No collections yet/)).toBeInTheDocument();
    expect(screen.queryByText("Note editor screen")).not.toBeInTheDocument();
  });
});

describe("Connection state", () => {
  function connectionError(reason) {
    const error = new Error("Request failed.");
    error.reason = reason;
    return error;
  }

  test("a missing editor server reports the server problem", async () => {
    getCollections.mockRejectedValue(connectionError("server"));
    renderAt(CATALOG_ROUTES.banknotes);

    expect(
      await screen.findByText("Can't reach the editor server."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Banknotes screen")).not.toBeInTheDocument();
  });

  test("a database that does not answer reports the database problem", async () => {
    getCollections.mockRejectedValue(connectionError("database"));
    renderAt(CATALOG_ROUTES.banknotes);

    expect(
      await screen.findByText("Can't reach the database."),
    ).toBeInTheDocument();
  });

  test("an unexpected load failure reports a generic problem", async () => {
    getCollections.mockRejectedValue(connectionError("generic"));
    renderAt(CATALOG_ROUTES.banknotes);

    expect(
      await screen.findByText("Can't check the connection."),
    ).toBeInTheDocument();
  });

  test("renders the page without waiting for a separate health probe", async () => {
    // The load never settles: the page must still paint (and no probe run),
    // which is the regression that gating the shell on /api/health introduced.
    getCollections.mockReturnValue(new Promise(() => {}));
    renderAt(CATALOG_ROUTES.banknotes);

    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
    expect(getHealth).not.toHaveBeenCalled();
  });

  test("retrying after the server returns loads the page", async () => {
    const user = userEvent.setup();
    getCollections.mockRejectedValueOnce(connectionError("server"));
    getHealth.mockResolvedValue({ connected: true });
    renderAt(CATALOG_ROUTES.banknotes);

    await user.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });

  test("a retry that still cannot reach the database keeps that problem", async () => {
    const user = userEvent.setup();
    getCollections.mockRejectedValue(connectionError("server"));
    getHealth.mockResolvedValue({ connected: false, reason: "database" });
    renderAt(CATALOG_ROUTES.banknotes);

    await user.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(
      await screen.findByText("Can't reach the database."),
    ).toBeInTheDocument();
  });

  test("paints the page under StrictMode without a health probe", async () => {
    getCollections.mockReturnValue(new Promise(() => {}));
    renderAtInStrictMode(CATALOG_ROUTES.banknotes);

    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
    expect(getHealth).not.toHaveBeenCalled();
  });
});
