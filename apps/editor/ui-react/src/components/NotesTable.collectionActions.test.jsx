import { MemoryRouter, useLocation } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotesTable } from "./NotesTable.jsx";

vi.mock("../lib/api.js", () => ({
  deleteNote: vi.fn(),
  getNotes: vi.fn(),
  reorderNotes: vi.fn(),
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

import { getNotes } from "../lib/api.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function note(id, denomination) {
  return {
    id,
    display_order: id,
    denomination,
    issue_date: "",
    catalog_number: "",
    grading_company: "",
    grade: "",
    serial: "",
    url: null,
    images: [],
    tags: [],
  };
}

function PathnameProbe() {
  const { pathname } = useLocation();
  return <output data-testid="pathname">{pathname}</output>;
}

function renderTable(overrides = {}) {
  return render(
    <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
      <PathnameProbe />
      <NotesTable
        collection={{ id: 1, is_default: 1, name: "Test" }}
        collectionId={1}
        collections={[{ id: 1, is_default: 1, name: "Test" }]}
        collectionsError=""
        loadingCollections={false}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
    writable: true,
  });
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    toJSON: () => ({}),
  }));
  getNotes.mockResolvedValue({
    notes: [note(1, "AAAA"), note(2, "BBBB")],
  });
});

describe("collection actions in the table header", () => {
  test("the collection title renames in place", async () => {
    const user = userEvent.setup();
    const onRenameCollection = vi.fn().mockResolvedValue(undefined);
    renderTable({ onRenameCollection });

    const title = await screen.findByRole("button", {
      name: "Rename collection: Test",
    });
    await user.click(title);

    const field = screen.getByRole("textbox", { name: "Collection name" });
    expect(field).toHaveValue("Test");
    expect(document.activeElement).toBe(field);

    await user.clear(field);
    await user.type(field, "  Renamed  ");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(onRenameCollection).toHaveBeenCalledWith("Renamed"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Collection name" }),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rename collection: Test" }),
    );
  });

  test("Escape cancels an inline rename without saving", async () => {
    const user = userEvent.setup();
    const onRenameCollection = vi.fn();
    renderTable({ onRenameCollection });

    await user.click(
      await screen.findByRole("button", { name: "Rename collection: Test" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Collection name" }),
      "Changed{Escape}",
    );

    expect(onRenameCollection).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Collection name" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename collection: Test" }),
    ).toHaveFocus();
  });

  test("an empty collection name is refused", async () => {
    const user = userEvent.setup();
    const onRenameCollection = vi.fn();
    renderTable({ onRenameCollection });

    await user.click(
      await screen.findByRole("button", { name: "Rename collection: Test" }),
    );
    const field = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(field);
    await user.keyboard("{Enter}");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A collection name is required.",
    );
    expect(onRenameCollection).not.toHaveBeenCalled();
    expect(field).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "A collection name is required.",
    );
  });

  test("Escape cannot abandon a rename that is already saving", async () => {
    const user = userEvent.setup();
    let finishRename;
    const onRenameCollection = vi.fn(
      () =>
        new Promise((resolve) => {
          finishRename = resolve;
        }),
    );
    renderTable({ onRenameCollection });

    await user.click(
      await screen.findByRole("button", { name: "Rename collection: Test" }),
    );
    const field = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(field);
    await user.type(field, "Renamed{Enter}");

    await waitFor(() =>
      expect(onRenameCollection).toHaveBeenCalledWith("Renamed"),
    );
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("textbox", { name: "Collection name" }),
    ).toBeInTheDocument();

    finishRename();
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Collection name" }),
      ).not.toBeInTheDocument(),
    );
  });

  test("a rejected rename keeps the field and shows the server's message", async () => {
    const user = userEvent.setup();
    const onRenameCollection = vi
      .fn()
      .mockRejectedValue(new Error("A collection with that name already exists."));
    renderTable({ onRenameCollection });

    await user.click(
      await screen.findByRole("button", { name: "Rename collection: Test" }),
    );
    const field = screen.getByRole("textbox", { name: "Collection name" });
    await user.clear(field);
    await user.type(field, "Taken");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A collection with that name already exists.",
    );
    expect(field).toBeInTheDocument();
  });

  test("the collection menu offers rename and delete", async () => {
    const user = userEvent.setup();
    renderTable({
      onRenameCollection: vi.fn(),
      onDeleteCollection: vi.fn(),
    });

    await user.click(
      await screen.findByRole("button", { name: "Collection actions" }),
    );

    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Delete collection…" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("menuitem", { name: "Rename" }));

    expect(
      screen.getByRole("textbox", { name: "Collection name" }),
    ).toBeInTheDocument();
  });

  test("delete asks first, then runs the action", async () => {
    const user = userEvent.setup();
    const onDeleteCollection = vi.fn().mockResolvedValue(undefined);
    renderTable({
      onRenameCollection: vi.fn(),
      onDeleteCollection,
    });

    await user.click(
      await screen.findByRole("button", { name: "Collection actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete collection…" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      'Delete "Test"?',
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteCollection).toHaveBeenCalledTimes(1));
  });

  test("cancelling the delete dialog leaves the collection alone", async () => {
    const user = userEvent.setup();
    const onDeleteCollection = vi.fn();
    renderTable({
      onRenameCollection: vi.fn(),
      onDeleteCollection,
    });

    await user.click(
      await screen.findByRole("button", { name: "Collection actions" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Delete collection…" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(onDeleteCollection).not.toHaveBeenCalled();
  });

  test("pressing e starts an inline rename instead of opening a route", async () => {
    const user = userEvent.setup();
    renderTable({ onRenameCollection: vi.fn() });

    await screen.findByRole("button", { name: "Add note" });
    await user.keyboard("e");

    expect(
      screen.getByRole("textbox", { name: "Collection name" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent(
      "/catalog/collections/1/view",
    );
  });

  test("switching collections closes an open rename", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable({ onRenameCollection: vi.fn() });

    await user.click(
      await screen.findByRole("button", { name: "Rename collection: Test" }),
    );
    expect(
      screen.getByRole("textbox", { name: "Collection name" }),
    ).toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={["/catalog/collections/1/view"]}>
        <PathnameProbe />
        <NotesTable
          collection={{ id: 2, is_default: 1, name: "Other" }}
          collectionId={2}
          collections={[
            { id: 1, is_default: 0, name: "Test" },
            { id: 2, is_default: 1, name: "Other" },
          ]}
          collectionsError=""
          loadingCollections={false}
          onRenameCollection={vi.fn()}
        />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "Collection name" }),
      ).not.toBeInTheDocument(),
    );
  });
});
