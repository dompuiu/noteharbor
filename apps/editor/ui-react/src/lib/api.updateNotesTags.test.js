import { afterEach, describe, expect, test, vi } from "vitest";
import { updateNotesTags } from "./api.js";

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

describe("updateNotesTags", () => {
  test("posts the ids and both lists to the scoped bulk route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { notes: [{ id: 3 }, { id: 1 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateNotesTags(7, [3, 1], ["Hoard"], ["For sale"]),
    ).resolves.toEqual({ notes: [{ id: 3 }, { id: 1 }] });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/7/notes/tags");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      note_ids: [3, 1],
      add: ["Hoard"],
      remove: ["For sale"],
    });
  });
});
