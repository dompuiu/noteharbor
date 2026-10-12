import { afterEach, describe, expect, test, vi } from "vitest";
import { getCollections } from "./api.js";

function stubFetch(implementation) {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

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

// The shell reads its connection state from this load, so the reason it carries
// on failure is what decides which connection error the user sees.
describe("getCollections connection reason", () => {
  test("flags an unreachable server when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new Error("connection refused")));

    await expect(getCollections()).rejects.toMatchObject({ reason: "server" });
  });

  test("flags a database outage from a 503", async () => {
    stubFetch(async () => jsonResponse(503, { error: "Database unavailable." }));

    await expect(getCollections()).rejects.toMatchObject({ reason: "database" });
  });

  test("flags any other failure as generic", async () => {
    stubFetch(async () => jsonResponse(500, { error: "boom" }));

    await expect(getCollections()).rejects.toMatchObject({ reason: "generic" });
  });

  test("resolves the payload on success", async () => {
    stubFetch(async () => jsonResponse(200, { collections: [] }));

    await expect(getCollections()).resolves.toEqual({ collections: [] });
  });
});
