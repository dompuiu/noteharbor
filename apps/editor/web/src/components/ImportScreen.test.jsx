import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ImportScreen } from "./ImportScreen.jsx";

vi.mock("../lib/api.js", () => ({
  clearAppData: vi.fn(),
  downloadArchive: vi.fn(),
  getOperationStatus: vi.fn(),
  importArchive: vi.fn(),
  importCsv: vi.fn(),
}));

import { getOperationStatus } from "../lib/api.js";

const collections = [
  { id: 1, is_default: 1, name: "Default" },
  { id: 2, is_default: 0, name: "Extras" },
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderImportScreen(overrides = {}) {
  const props = {
    activeCollection: collections[0],
    activeCollectionId: 1,
    collections,
    collectionsError: "",
    loadingCollections: false,
    onSelectCollection: vi.fn(),
    ...overrides,
  };

  render(
    <MemoryRouter initialEntries={["/catalog/import-export"]}>
      <ImportScreen {...props} />
      <LocationProbe />
    </MemoryRouter>,
  );

  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOperationStatus.mockResolvedValue({
    currentOperation: "idle",
    isBusy: false,
    startedAt: null,
    details: null,
  });
});

describe("ImportScreen collection controls", () => {
  test("still lets the user choose the collection an import targets", async () => {
    const user = userEvent.setup();
    const { onSelectCollection } = renderImportScreen();

    const select = await screen.findByLabelText("Active collection");

    expect(select).toHaveValue("1");
    expect(screen.getByRole("option", { name: /Default/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Extras" })).toBeInTheDocument();

    await user.selectOptions(select, "2");

    expect(onSelectCollection).toHaveBeenCalledWith(2);
  });

  test("places the target selector inside the CSV import card it feeds", async () => {
    renderImportScreen();

    const select = await screen.findByLabelText("Active collection");
    const csvCard = select.closest("form");

    expect(csvCard).not.toBeNull();
    expect(csvCard).toHaveTextContent("CSV Import");
    // The archive card is a separate form and must not host the selector.
    expect(
      screen
        .getByText("Archive Import and Export")
        .closest("form")
        .contains(select),
    ).toBe(false);
  });

  test("no longer offers create, rename, delete, or set-default controls", async () => {
    renderImportScreen();

    await screen.findByLabelText("Active collection");

    expect(screen.queryByPlaceholderText("Collection name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set default" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("ImportScreen navigation affordances", () => {
  test("no longer shows a Back to table link", async () => {
    renderImportScreen();

    await screen.findByLabelText("Active collection");

    expect(screen.queryByRole("link", { name: /back to table/i })).toBeNull();
  });

  test("Escape stays on the import screen", async () => {
    const user = userEvent.setup();
    renderImportScreen();

    await screen.findByLabelText("Active collection");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/catalog/import-export",
    );

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/catalog/import-export",
    );
  });
});
