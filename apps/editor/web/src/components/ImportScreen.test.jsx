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
}));

import { downloadArchive, getOperationStatus } from "../lib/api.js";

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
    collections,
    collectionsError: "",
    loadingCollections: false,
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

describe("ImportScreen CSV removal", () => {
  test("offers no CSV import option or text", async () => {
    renderImportScreen();

    await screen.findByText("Archive Import and Export");

    expect(
      screen.queryByText(/CSV Import/i),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Import CSV/i }),
    ).toBeNull();
    expect(screen.queryByLabelText("Active collection")).toBeNull();
    expect(screen.queryByText(/\.csv/i)).toBeNull();
  });

  test("no longer offers create, rename, delete, or set-default controls", async () => {
    renderImportScreen();

    await screen.findByText("Archive Import and Export");

    expect(screen.queryByPlaceholderText("Collection name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Set default" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});

describe("ImportScreen export reporting", () => {
  test("reports the showcases a filtered export omitted", async () => {
    const user = userEvent.setup();
    downloadArchive.mockResolvedValue({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: ["Outside Show"],
    });
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await user.click(screen.getByRole("button", { name: "Download archive" }));

    expect(await screen.findByText(/Omitted showcases/)).toHaveTextContent(
      "Outside Show",
    );
  });
});

describe("ImportScreen navigation affordances", () => {
  test("no longer shows a Back to table link", async () => {
    renderImportScreen();

    await screen.findByText("Archive Import and Export");

    expect(screen.queryByRole("link", { name: /back to table/i })).toBeNull();
  });

  test("Escape stays on the import screen", async () => {
    const user = userEvent.setup();
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/catalog/import-export",
    );

    await user.keyboard("{Escape}");

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/catalog/import-export",
    );
  });
});
