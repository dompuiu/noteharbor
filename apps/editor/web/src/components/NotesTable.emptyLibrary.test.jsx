import { MemoryRouter, useLocation } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";
import { CATALOG_ROUTES } from "../lib/routes.js";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  getOperationStatus: vi.fn(),
  reorderNotes: vi.fn(),
  getScrapeStatus: vi.fn(),
  startScrape: vi.fn(),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        size: 43,
        start: index * 43,
        end: (index + 1) * 43,
      })),
    getTotalSize: () => count * 43,
    measureElement: () => {},
    scrollToIndex: () => {},
    scrollToOffset: () => {},
  }),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function HashProbe() {
  const location = useLocation();
  return <output data-testid="hash">{location.hash}</output>;
}

function renderEmptyLibrary() {
  return render(
    <MemoryRouter>
      <HashProbe />
      <NotesTable
        activeCollection={null}
        activeCollectionId={null}
        collections={[]}
        collectionsError=""
        loadingCollections={false}
        onSelectCollection={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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
});

describe("NotesTable with no collections", () => {
  test("shows the empty-library prompt instead of a plain empty table", async () => {
    renderEmptyLibrary();

    expect(
      await screen.findByText(/No collections yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Import / Export" }),
    ).toHaveAttribute("href", CATALOG_ROUTES.importExport);
    expect(
      screen.getByRole("link", { name: "Create a collection" }),
    ).toHaveAttribute("href", CATALOG_ROUTES.collections);
  });

  test("hides the collection selector and disables Add note", async () => {
    renderEmptyLibrary();

    await screen.findByText(/No collections yet/);

    expect(screen.queryByLabelText("Active collection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
  });

  test("the a shortcut does not open the create form", async () => {
    renderEmptyLibrary();

    await screen.findByText(/No collections yet/);

    fireEvent.keyDown(document.body, { key: "a" });

    expect(screen.getByTestId("hash").textContent).toBe("");
  });
});
