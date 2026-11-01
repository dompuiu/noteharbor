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

vi.mock("../lib/navigation.js", () => ({
  assignLocation: vi.fn(),
}));

import { downloadArchive, getOperationStatus, importArchive } from "../lib/api.js";
import { assignLocation } from "../lib/navigation.js";

const collections = [
  { id: 1, is_default: 1, name: "Default" },
  { id: 2, is_default: 0, name: "Extras" },
];

const showcases = [
  { id: 10, name: "Show One", required_collection_ids: [1] },
  { id: 11, name: "Show Two", required_collection_ids: [1, 2] },
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
    showcases,
    showcasesError: "",
    loadingShowcases: false,
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
  window.localStorage.clear();
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

describe("ImportScreen showcase export", () => {
  test("selecting a showcase auto-selects the collections it needs", async () => {
    const user = userEvent.setup();
    renderImportScreen();

    await screen.findByText("Archive Import and Export");

    // Deselect "Extras": "Show Two" needs it, so the export blocks.
    await user.click(screen.getByRole("checkbox", { name: "Extras" }));
    expect(
      await screen.findByText(/Showcase "Show Two" needs "Extras"/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download archive" }),
    ).toBeDisabled();

    // Deselecting the showcase clears the block.
    await user.click(screen.getByRole("checkbox", { name: "Show Two" }));
    expect(screen.queryByText(/needs "Extras"/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download archive" }),
    ).not.toBeDisabled();

    // Re-selecting the showcase pulls the missing collection back in.
    await user.click(screen.getByRole("checkbox", { name: "Show Two" }));
    expect(screen.getByRole("checkbox", { name: "Extras" })).toBeChecked();
    expect(screen.queryByText(/needs "Extras"/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download archive" }),
    ).not.toBeDisabled();
  });

  test("the export carries the selected showcase ids", async () => {
    const user = userEvent.setup();
    downloadArchive.mockResolvedValue({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: [],
    });
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await user.click(screen.getByRole("checkbox", { name: "Show Two" }));
    await user.click(screen.getByRole("button", { name: "Download archive" }));

    expect(downloadArchive).toHaveBeenCalledWith([1, 2], [10]);
    expect(await screen.findByText(/Showcases included: 1/)).toBeInTheDocument();
  });

  test("deselecting a needed collection blocks the export", async () => {
    const user = userEvent.setup();
    downloadArchive.mockResolvedValue({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: [],
    });
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await user.click(screen.getByRole("checkbox", { name: "Default" }));

    expect(
      await screen.findByText(/Showcase "Show One" needs "Default"/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download archive" }),
    ).toBeDisabled();
    expect(downloadArchive).not.toHaveBeenCalled();
  });
});

describe("ImportScreen import mode", () => {
  // The navigation seam is a module mock, so no window mutation (and no
  // restore) is needed. The top-level beforeEach clears calls between tests.
  function stubNavigation() {
    return assignLocation;
  }

  async function chooseArchiveFile(user) {
    const file = new File(["archive"], "noteharbor-archive.zip", {
      type: "application/zip",
    });
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, file);
    return file;
  }

  test("defaults to replacing all current data", async () => {
    renderImportScreen();

    await screen.findByText("Archive Import and Export");

    expect(screen.getByRole("radio", { name: /replace/i })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /merge/i }),
    ).not.toBeChecked();
  });

  test("a replace import passes the replace mode", async () => {
    const user = userEvent.setup();
    const assign = stubNavigation();
    importArchive.mockResolvedValue({ success: true, mode: "replace" });
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    const file = await chooseArchiveFile(user);
    await user.click(screen.getByRole("button", { name: "Import archive" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(importArchive).toHaveBeenCalledWith(
      file,
      expect.any(Function),
      "replace",
    );
    expect(assign).toHaveBeenCalledWith("/catalog/collections");
  });

  test("a merge import passes the merge mode and also forgets the saved table structure", async () => {
    const user = userEvent.setup();
    stubNavigation();
    importArchive.mockResolvedValue({ success: true, mode: "merge" });
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "denomination",
        sortDirection: "desc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );
    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    const file = await chooseArchiveFile(user);
    await user.click(screen.getByRole("radio", { name: /merge/i }));
    await user.click(screen.getByRole("button", { name: "Import archive" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(importArchive).toHaveBeenCalledWith(
      file,
      expect.any(Function),
      "merge",
    );
    // Merge deletes and re-inserts the collections it matches by name, so
    // their ids change too.
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();
  });

  test("a successful import forgets the saved table structure", async () => {
    const user = userEvent.setup();
    const assign = stubNavigation();
    importArchive.mockResolvedValue({ success: true, mode: "replace" });
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "denomination",
        sortDirection: "desc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );
    window.localStorage.setItem("noteharbor.lastVisitedRoute", "/elsewhere");
    window.localStorage.setItem("noteharbor.showcasePhotoSize", "large");

    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await chooseArchiveFile(user);
    await user.click(screen.getByRole("button", { name: "Import archive" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    // Import renumbers collections, so every id-keyed payload is meaningless
    // afterwards and must not be applied to whatever lands on that id.
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("noteharbor.lastVisitedRoute"),
    ).toBe("/elsewhere");
    expect(window.localStorage.getItem("noteharbor.showcasePhotoSize")).toBe(
      "large",
    );
    expect(assign).toHaveBeenCalledWith("/catalog/collections");
  });

  test("a cancelled import keeps the saved table structure", async () => {
    const user = userEvent.setup();
    stubNavigation();
    importArchive.mockResolvedValue({ success: true, mode: "replace" });
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "denomination",
        sortDirection: "desc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );

    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await chooseArchiveFile(user);
    await user.click(screen.getByRole("button", { name: "Import archive" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(importArchive).not.toHaveBeenCalled();
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).not.toBeNull();
  });

  test("a failed import keeps the saved table structure", async () => {
    const user = userEvent.setup();
    stubNavigation();
    importArchive.mockRejectedValue(new Error("Archive is corrupt."));
    window.localStorage.setItem(
      "noteharbor.notesTableState.1",
      JSON.stringify({
        sortKey: "denomination",
        sortDirection: "desc",
        visibleColumnKeys: ["id", "denomination"],
      }),
    );

    renderImportScreen();

    await screen.findByText("Archive Import and Export");
    await chooseArchiveFile(user);
    await user.click(screen.getByRole("button", { name: "Import archive" }));
    await user.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText("Archive is corrupt.")).toBeInTheDocument();
    expect(
      window.localStorage.getItem("noteharbor.notesTableState.1"),
    ).not.toBeNull();
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
