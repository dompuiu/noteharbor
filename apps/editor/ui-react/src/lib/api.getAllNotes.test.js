import { afterEach, describe, expect, test, vi } from "vitest";
import { getAllNotes } from "./api.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAllNotes", () => {
  test("fans out per collection and flattens in sidebar order with collection context", async () => {
    const fetchMock = vi.fn(async (url) =>
      url === "/api/collections/2/notes"
        ? jsonResponse(200, {
            notes: [{ id: 3, catalog_number: "P-22a" }],
          })
        : jsonResponse(200, {
            notes: [
              { id: 1, catalog_number: "Fr. 2300" },
              { id: 2, catalog_number: "Fr. 500" },
            ],
          }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payload = await getAllNotes([
      { id: 1, name: "Serban's Notes" },
      { id: 2, name: "Vault" },
    ]);

    expect(payload.notes).toEqual([
      {
        id: 1,
        catalog_number: "Fr. 2300",
        collection: "Serban's Notes",
        collection_id: 1,
        collection_name: "Serban's Notes",
        collection_order: 1,
      },
      {
        id: 2,
        catalog_number: "Fr. 500",
        collection: "Serban's Notes",
        collection_id: 1,
        collection_name: "Serban's Notes",
        collection_order: 1,
      },
      {
        id: 3,
        catalog_number: "P-22a",
        collection: "Vault",
        collection_id: 2,
        collection_name: "Vault",
        collection_order: 2,
      },
    ]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/collections/1/notes",
      "/api/collections/2/notes",
    ]);
  });

  test("rejects the whole list when one collection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url === "/api/collections/2/notes"
          ? jsonResponse(500, { error: "boom" })
          : jsonResponse(200, { notes: [{ id: 1 }] }),
      ),
    );

    await expect(
      getAllNotes([
        { id: 1, name: "One" },
        { id: 2, name: "Two" },
      ]),
    ).rejects.toThrow("boom");
  });

  test("an empty collection list makes no requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAllNotes([])).resolves.toEqual({ notes: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
