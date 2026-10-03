import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api.js", () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollections: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
  setDefaultCollection: vi.fn(),
}));

import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
  setDefaultCollection,
} from "./api.js";
import { CollectionsProvider, useCollections } from "./collections.jsx";

// A tiny consumer that surfaces the context controls so tests can drive them
// and read back the state the provider hands out.
let context;
function Probe() {
  context = useCollections();
  return <output data-testid="names">{context.collections.map((c) => c.name).join(",")}</output>;
}

function renderProvider() {
  return render(
    <CollectionsProvider>
      <Probe />
    </CollectionsProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  getCollections.mockResolvedValue({
    collections: [
      { id: 1, is_default: 1, name: "Default" },
      { id: 2, is_default: 0, name: "Archive" },
    ],
  });
});

describe("CollectionsProvider mutations", () => {
  test("creating a collection appends it without refetching the whole list", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    const loadsBefore = getCollections.mock.calls.length;
    createCollection.mockResolvedValue({
      collection: { id: 3, is_default: 0, name: "Third" },
    });

    await act(async () => {
      await context.createCollection("Third");
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Default,Archive,Third");
    expect(getCollections.mock.calls.length).toBe(loadsBefore);
    // The new collection becomes active, since new notes land there.
    expect(context.activeCollectionId).toBe(3);
  });

  test("renaming patches the row in place without refetching", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    const loadsBefore = getCollections.mock.calls.length;
    renameCollection.mockResolvedValue({
      collection: { id: 2, is_default: 0, name: "Renamed" },
    });

    await act(async () => {
      await context.renameCollection(2, "Renamed");
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Default,Renamed");
    expect(getCollections.mock.calls.length).toBe(loadsBefore);
  });

  test("setting the default flips the flag in place without refetching", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    const loadsBefore = getCollections.mock.calls.length;
    setDefaultCollection.mockResolvedValue({
      collection: { id: 2, is_default: 1, name: "Archive" },
    });

    await act(async () => {
      await context.setDefaultCollection(2);
    });

    expect(getCollections.mock.calls.length).toBe(loadsBefore);
    expect(
      context.collections.find((c) => c.id === 2).is_default,
    ).toBe(1);
    expect(
      context.collections.find((c) => c.id === 1).is_default,
    ).toBe(0);
  });

  test("deleting removes the row without refetching and moves the active collection", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    const loadsBefore = getCollections.mock.calls.length;
    deleteCollection.mockResolvedValue({ success: true });

    await act(async () => {
      await context.deleteCollection(1);
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Archive");
    expect(getCollections.mock.calls.length).toBe(loadsBefore);
    expect(context.activeCollectionId).toBe(2);
  });
});
