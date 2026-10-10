import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/collections.jsx", () => ({
  useCollections: vi.fn(),
}));

vi.mock("./ConfirmDialog.jsx", () => ({
  useConfirmation: vi.fn(),
}));

vi.mock("./NotesTable.jsx", () => ({
  NotesTable: ({ editCollectionTo }) => (
    <div data-edit-to={editCollectionTo ?? ""} data-testid="notes-table">
      Banknotes table
    </div>
  ),
}));

import { CollectionScreen } from "./CollectionScreen.jsx";
import { useCollections } from "../lib/collections.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { CATALOG_ROUTES } from "../lib/routes.js";

function collectionsContext(overrides = {}) {
  return {
    activeCollection: { id: 1, is_default: 1, name: "Default" },
    activeCollectionId: 1,
    collections: [
      { id: 1, is_default: 1, name: "Default", note_count: 3 },
      { id: 2, is_default: 0, name: "Archive", note_count: 0 },
    ],
    loadingCollections: false,
    collectionsError: "",
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    setDefaultCollection: vi.fn(),
    deleteCollection: vi.fn(),
    selectCollection: vi.fn(),
    pendingCollection: null,
    beginPendingCollection: vi.fn(),
    discardPendingCollection: vi.fn(),
    ...overrides,
  };
}

function confirmControls(overrides = {}) {
  return {
    confirm: vi.fn().mockResolvedValue(false),
    dialog: null,
    isOpen: false,
    ...overrides,
  };
}

function PathnameProbe() {
  const { pathname } = useLocation();
  return <output data-testid="pathname">{pathname}</output>;
}

function renderAt(path, mode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PathnameProbe />
      <Routes>
        <Route element={<CollectionScreen mode="view" />} path="/catalog/collections/:id/view" />
        <Route element={<CollectionScreen mode="edit" />} path="/catalog/collections/:id/edit" />
      </Routes>
    </MemoryRouter>,
  );
}

function renderView(id) {
  return renderAt(CATALOG_ROUTES.collection(id), "view");
}

function renderEdit(id) {
  return renderAt(CATALOG_ROUTES.collectionEdit(id), "edit");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useCollections.mockReturnValue(collectionsContext());
  useConfirmation.mockReturnValue(confirmControls());
});

describe("CollectionScreen view mode", () => {
  test("skips its own header copy since the banknotes table shows the name", () => {
    const { container } = renderView(1);

    // The table owns the title now; the view keeps no panel of its own.
    expect(container.querySelector(".panel")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("Banknotes table")).toBeInTheDocument();
  });

  test("hands the table the edit destination for its header action", () => {
    renderView(1);

    expect(screen.getByTestId("notes-table")).toHaveAttribute(
      "data-edit-to",
      CATALOG_ROUTES.collectionEdit(1),
    );
  });

  test("viewing a collection selects it as active", () => {
    const selectCollection = vi.fn();
    useCollections.mockReturnValue(collectionsContext({ activeCollectionId: 2, selectCollection }));
    renderView(1);

    expect(selectCollection).toHaveBeenCalledWith(1);
  });

  test("an unknown collection shows the not-found state", () => {
    renderView(99);

    expect(screen.getByText("Collection not found.")).toBeInTheDocument();
  });
});

describe("CollectionScreen edit mode", () => {
  test("Save stays disabled until the name or default changes", async () => {
    const user = userEvent.setup();
    renderEdit(2);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: "Collection name" }));
    await user.type(screen.getByRole("textbox", { name: "Collection name" }), "Renamed");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
    });
  });

  test("saving a rename goes through the context", async () => {
    const user = userEvent.setup();
    const renameCollection = vi.fn().mockResolvedValue({ id: 2, name: "Renamed" });
    useCollections.mockReturnValue(collectionsContext({ renameCollection }));
    renderEdit(2);

    const input = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(input);
    await user.type(input, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(renameCollection).toHaveBeenCalledWith(2, "Renamed");
    });
  });

  test("toggling default saves through the context", async () => {
    const user = userEvent.setup();
    const setDefaultCollection = vi.fn().mockResolvedValue({ id: 2, is_default: 1 });
    useCollections.mockReturnValue(collectionsContext({ setDefaultCollection }));
    renderEdit(2);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(setDefaultCollection).toHaveBeenCalledWith(2);
    });
  });

  test("Cancel returns to view without saving", async () => {
    const user = userEvent.setup();
    const renameCollection = vi.fn();
    useCollections.mockReturnValue(collectionsContext({ renameCollection }));
    renderEdit(2);

    const input = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(input);
    await user.type(input, "Changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(renameCollection).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByTestId("pathname")).toHaveTextContent(
        CATALOG_ROUTES.collection(2),
      );
    });
  });

  test("deleting goes through the context after confirmation", async () => {
    const user = userEvent.setup();
    const deleteCollection = vi.fn().mockResolvedValue({ nextCollectionId: 1 });
    useCollections.mockReturnValue(collectionsContext({ deleteCollection }));
    useConfirmation.mockReturnValue(confirmControls({ confirm: vi.fn().mockResolvedValue(true) }));
    renderEdit(2);

    await user.click(screen.getByRole("button", { name: "Delete collection" }));

    await waitFor(() => {
      expect(deleteCollection).toHaveBeenCalledWith(2);
    });
  });
});

describe("CollectionScreen new draft", () => {
  test("a direct load stages a pending draft so the sidebar agrees", () => {
    const beginPendingCollection = vi.fn();
    useCollections.mockReturnValue(
      collectionsContext({ pendingCollection: null, beginPendingCollection }),
    );
    renderEdit("new");

    expect(beginPendingCollection).toHaveBeenCalled();
  });

  test("an untouched default name omits the name so the server picks a unique one", async () => {
    const user = userEvent.setup();
    const createCollection = vi.fn().mockResolvedValue({ id: 9, name: "Collection 2" });
    useCollections.mockReturnValue(
      collectionsContext({
        pendingCollection: { id: "new", name: "Collection" },
        createCollection,
      }),
    );
    renderEdit("new");

    // The draft name is non-empty, so Save is enabled even with no edits.
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createCollection).toHaveBeenCalledWith(undefined);
    });
  });

  test("a typed draft name posts that name", async () => {
    const user = userEvent.setup();
    const createCollection = vi.fn().mockResolvedValue({ id: 9, name: "Third" });
    useCollections.mockReturnValue(
      collectionsContext({
        pendingCollection: { id: "new", name: "Collection" },
        createCollection,
      }),
    );
    renderEdit("new");

    const input = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(input);
    await user.type(input, "Third");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createCollection).toHaveBeenCalledWith("Third");
    });
  });

  test("Cancel on a draft discards it without posting", async () => {
    const user = userEvent.setup();
    const createCollection = vi.fn();
    const discardPendingCollection = vi.fn();
    useCollections.mockReturnValue(
      collectionsContext({
        pendingCollection: { id: "new", name: "Collection" },
        createCollection,
        discardPendingCollection,
      }),
    );
    renderEdit("new");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(createCollection).not.toHaveBeenCalled();
    expect(discardPendingCollection).toHaveBeenCalled();
  });
});
