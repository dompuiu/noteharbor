import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

// The routing tests assert where each path lands, not what the screens render,
// so the screens are stubbed out. Only the collections payload drives the
// no-collections guard.
vi.mock("./lib/api.js", () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollections: vi.fn(),
  renameCollection: vi.fn(),
  setDefaultCollection: vi.fn(),
}));

vi.mock("./components/NotesTable.jsx", () => ({
  NotesTable: () => <div>Banknotes screen</div>,
}));

vi.mock("./components/ImportScreen.jsx", () => ({
  ImportScreen: () => <div>Import and export screen</div>,
}));

vi.mock("./components/NoteEditForm.jsx", () => ({
  NoteEditForm: () => <div>Note editor screen</div>,
}));

import { ShellContent } from "./App.jsx";
import { CollectionsProvider } from "./lib/collections.jsx";
import { getCollections } from "./lib/api.js";
import { CATALOG_ROUTES } from "./lib/routes.js";

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

function currentPath() {
  return screen.getByTestId("pathname").textContent;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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

describe("Legacy path redirects", () => {
  test("/ redirects to /catalog/banknotes", async () => {
    renderAt("/");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.banknotes);
    });
    expect(await screen.findByText("Banknotes screen")).toBeInTheDocument();
  });

  test("/import redirects to /catalog/import-export", async () => {
    renderAt("/import");

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.importExport);
    });
    expect(await screen.findByText("Import and export screen")).toBeInTheDocument();
  });

  test("/notes/:id/edit redirects to /catalog/notes/:id/edit", async () => {
    renderAt("/notes/7/edit");

    await waitFor(() => {
      expect(currentPath()).toBe("/catalog/notes/7/edit");
    });
    expect(await screen.findByText("Note editor screen")).toBeInTheDocument();
  });
});

describe("No-collections guard", () => {
  test("sends an empty library to /catalog/import-export", async () => {
    getCollections.mockResolvedValue({ collections: [] });
    renderAt(CATALOG_ROUTES.banknotes);

    await waitFor(() => {
      expect(currentPath()).toBe(CATALOG_ROUTES.importExport);
    });
    expect(await screen.findByText("Import and export screen")).toBeInTheDocument();
  });
});
