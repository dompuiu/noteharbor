import { afterEach, describe, expect, test, vi } from "vitest";
import { moveNotes } from "./api.js";

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

describe("moveNotes", () => {
  test("posts the group to the scoped bulk route in the caller's order", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { notes: [{ id: 2 }, { id: 1 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      moveNotes([2, 1], 7, 9, { mode: "before", referenceId: 42 }),
    ).resolves.toEqual({ notes: [{ id: 2 }, { id: 1 }] });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/7/notes/move");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      note_ids: [2, 1],
      target_collection_id: 9,
      position_mode: "before",
      position_reference_id: 42,
    });
  });

  test("sends no reference for a start/end position", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { notes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await moveNotes([1], 7, 9, { mode: "end" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      note_ids: [1],
      target_collection_id: 9,
      position_mode: "end",
      position_reference_id: null,
    });
  });
});
