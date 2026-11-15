import { afterEach, describe, expect, test, vi } from "vitest";
import { updateNotesOwned } from "./api.js";

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

describe("updateNotesOwned", () => {
  test("posts the ids and the flag to the scoped bulk route", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { notes: [{ id: 3 }, { id: 1 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateNotesOwned(7, [3, 1], true)).resolves.toEqual({
      notes: [{ id: 3 }, { id: 1 }],
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/collections/7/notes/ownership");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      note_ids: [3, 1],
      owned: true,
    });
  });
});
