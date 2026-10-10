import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api.js", () => ({
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  getCollections: vi.fn(),
  renameCollection: vi.fn(),
  reorderCollections: vi.fn(),
}));

import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
} from "./api.js";
import { CollectionsProvider, useCollections } from "./collections.jsx";

// A tiny consumer that surfaces the context controls so tests can drive them
// and read back the state the provider hands out.
let context;
function Probe() {
  context = useCollections();
  return (
    <>
      <output data-testid="names">{context.collections.map((c) => c.name).join(",")}</output>
      <output data-testid="reason">{context.collectionsErrorReason ?? ""}</output>
    </>
  );
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

  test("exposes no default-collection control", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    expect(context.setDefaultCollection).toBeUndefined();
  });

  test("deleting removes the row without refetching and reports the neighbour", async () => {
    renderProvider();
    await screen.findByText("Default,Archive");

    const loadsBefore = getCollections.mock.calls.length;
    deleteCollection.mockResolvedValue({ success: true });

    let result;
    await act(async () => {
      result = await context.deleteCollection(1);
    });

    expect(screen.getByTestId("names")).toHaveTextContent("Archive");
    expect(getCollections.mock.calls.length).toBe(loadsBefore);
    expect(result.nextCollectionId).toBe(2);
  });
});

describe("CollectionsProvider connection reason", () => {
  test("records why a failed load failed so the shell can report it", async () => {
    const error = new Error("Request failed.");
    error.reason = "database";
    getCollections.mockRejectedValue(error);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent("database");
    });
    expect(screen.getByTestId("names")).toHaveTextContent("");
  });

  test("clears the reason once a load succeeds", async () => {
    const error = new Error("Request failed.");
    error.reason = "server";
    getCollections.mockRejectedValueOnce(error);

    renderProvider();

    await waitFor(() => {
      expect(screen.getByTestId("reason")).toHaveTextContent("server");
    });

    await act(async () => {
      await context.refreshCollections();
    });

    expect(screen.getByTestId("reason")).toHaveTextContent("");
    expect(screen.getByTestId("names")).toHaveTextContent("Default,Archive");
  });
});
