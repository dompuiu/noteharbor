import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
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

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderNewCollection(overrides = {}) {
  return render(
    <MemoryRouter>
      <NotesTable
        collection={null}
        collectionId={null}
        collections={[{ id: 1, is_default: 1, name: "Default" }]}
        collectionsError=""
        loadingCollections={false}
        isNewCollection
        newCollectionName="Collection"
        onNewCollectionNameChange={vi.fn()}
        onSaveNewCollection={vi.fn()}
        onCancelNewCollection={vi.fn()}
        savingNewCollection={false}
        newCollectionError=""
        {...overrides}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

describe("NotesTable new collection draft", () => {
  test("focuses the title field with save/cancel icons like the inline rename", async () => {
    renderNewCollection();

    const input = await screen.findByRole("textbox", { name: "Collection name" });
    expect(document.activeElement).toBe(input);
    expect(input).toHaveClass("showcase-name-field");

    const saves = screen.getAllByRole("button", { name: "Save" });
    const cancels = screen.getAllByRole("button", { name: "Cancel" });
    expect(saves.some((button) => button.classList.contains("showcase-node-save"))).toBe(true);
    expect(saves.some((button) => button.classList.contains("button"))).toBe(true);
    expect(cancels.some((button) => button.classList.contains("showcase-node-cancel"))).toBe(true);
    expect(cancels.some((button) => button.classList.contains("button"))).toBe(true);
  });

  test("typing reports the draft name and submitting saves it", async () => {
    const user = userEvent.setup();
    const onNewCollectionNameChange = vi.fn();
    const onSaveNewCollection = vi.fn();
    renderNewCollection({ onNewCollectionNameChange, onSaveNewCollection });

    const input = await screen.findByRole("textbox", { name: "Collection name" });
    await user.clear(input);
    await user.type(input, "Third");

    expect(onNewCollectionNameChange).toHaveBeenCalled();
    const save = screen
      .getAllByRole("button", { name: "Save" })
      .find((button) => button.classList.contains("button"));
    await user.click(save);
    expect(onSaveNewCollection).toHaveBeenCalledTimes(1);
  });

  test("Escape cancels the draft like Cancel", async () => {
    const onCancelNewCollection = vi.fn();
    renderNewCollection({ onCancelNewCollection });

    const input = await screen.findByRole("textbox", { name: "Collection name" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onCancelNewCollection).toHaveBeenCalledTimes(1);
  });

  test("shows the same empty table with Cancel/Save instead of Add note", async () => {
    const { getNotes } = await import("../lib/api.js");
    renderNewCollection();

    // Same chrome as the view: headers, filter row, empty copy, count.
    expect(await screen.findByText("0 notes in the current view.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ID/ })).toBeInTheDocument();
    expect(screen.getByText("FRONT")).toBeInTheDocument();
    expect(
      screen.getByText(/No notes are stored yet/),
    ).toBeInTheDocument();
    // The draft has no Add note: the actions mirror the collection edit
    // view, without Delete since there is nothing saved yet.
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete collection" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(2);
    expect(getNotes).not.toHaveBeenCalled();
  });

  test("surfaces the draft error under the title", async () => {
    renderNewCollection({ newCollectionError: "A collection name is required." });

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent("A collection name is required.");
  });
});
