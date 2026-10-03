import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/collections.jsx", () => ({
  useCollections: vi.fn(),
}));

import { CollectionsScreen } from "./CollectionsScreen.jsx";
import { useCollections } from "../lib/collections.jsx";

function collectionsContext(overrides = {}) {
  return {
    activeCollection: { id: 1, is_default: 1, name: "Default" },
    activeCollectionId: 1,
    collections: [
      { id: 1, is_default: 1, name: "Default", note_count: 3 },
      { id: 2, is_default: 0, name: "Archive", note_count: 0 },
    ],
    collectionsError: "",
    createCollection: vi.fn(),
    deleteCollection: vi.fn(),
    loadingCollections: false,
    refreshCollections: vi.fn(),
    renameCollection: vi.fn(),
    reorderCollections: vi.fn(),
    selectCollection: vi.fn(),
    setDefaultCollection: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCollections.mockReturnValue(collectionsContext());
});

describe("CollectionsScreen", () => {
  test("lists every collection as a row showing its name", () => {
    render(<CollectionsScreen />);

    const nameCells = screen
      .getByRole("table")
      .querySelectorAll("tbody .named-records-name-cell");

    expect(
      Array.from(nameCells, (cell) => cell.textContent),
    ).toEqual(["Default", "Archive"]);
  });

  test("marks exactly the default collection", () => {
    render(<CollectionsScreen />);

    expect(
      screen.getByRole("button", { name: "Default is the default" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Mark Archive as default" }),
    ).toBeInTheDocument();
  });

  test("shows how many notes each collection holds", () => {
    render(<CollectionsScreen />);

    const counts = Array.from(
      screen.getByRole("table").querySelectorAll("tbody .named-records-count-cell"),
      (cell) => cell.textContent,
    );

    expect(counts).toEqual(["3", "0"]);
  });

  test("refreshes collections on entry so the note counts are current", () => {
    const refreshCollections = vi.fn();
    useCollections.mockReturnValue(collectionsContext({ refreshCollections }));
    render(<CollectionsScreen />);

    expect(refreshCollections).toHaveBeenCalled();
  });

  test("creating a collection goes through the context", async () => {
    const user = userEvent.setup();
    const createCollection = vi.fn().mockResolvedValue({ id: 3, name: "New" });
    useCollections.mockReturnValue(collectionsContext({ createCollection }));
    render(<CollectionsScreen />);

    await user.click(screen.getByRole("button", { name: "Add collection" }));
    await user.type(
      screen.getByRole("textbox", { name: "New collection name" }),
      "Third{Enter}",
    );

    expect(createCollection).toHaveBeenCalledWith("Third");
  });

  test("renaming a collection goes through the context", async () => {
    const user = userEvent.setup();
    const renameCollection = vi.fn().mockResolvedValue({ id: 2, name: "Renamed" });
    useCollections.mockReturnValue(collectionsContext({ renameCollection }));
    render(<CollectionsScreen />);

    await user.click(screen.getByRole("button", { name: "Rename Archive" }));
    const input = screen.getByRole("textbox", { name: "Rename Archive" });
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(renameCollection).toHaveBeenCalledWith(2, "Renamed");
  });

  test("deleting a collection goes through the context after confirmation", async () => {
    const user = userEvent.setup();
    const deleteCollection = vi.fn().mockResolvedValue(undefined);
    useCollections.mockReturnValue(collectionsContext({ deleteCollection }));
    render(<CollectionsScreen />);

    await user.click(screen.getByRole("button", { name: "Delete Archive" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(deleteCollection).toHaveBeenCalledWith(2);
  });

  test("setting the default goes through the context", async () => {
    const user = userEvent.setup();
    const setDefaultCollection = vi.fn().mockResolvedValue(undefined);
    useCollections.mockReturnValue(collectionsContext({ setDefaultCollection }));
    render(<CollectionsScreen />);

    await user.click(
      screen.getByRole("button", { name: "Mark Archive as default" }),
    );

    expect(setDefaultCollection).toHaveBeenCalledWith(2);
  });

  test("offers a drag handle per row wired to reordering", () => {
    render(<CollectionsScreen />);

    expect(
      screen.getByRole("button", { name: "Move Archive" }),
    ).toBeInTheDocument();
  });

  test("shows the loading and error states", () => {
    useCollections.mockReturnValue(
      collectionsContext({
        collections: [],
        collectionsError: "Collections failed to load.",
        loadingCollections: true,
      }),
    );
    render(<CollectionsScreen />);

    expect(screen.getByText("Loading collections...")).toBeInTheDocument();
    expect(screen.getByText("Collections failed to load.")).toBeInTheDocument();
    // A still-loading (or failed) list must not also claim to be empty.
    expect(
      screen.queryByText(/No collections yet/),
    ).not.toBeInTheDocument();
  });
});
