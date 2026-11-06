import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNote, getNotes } from "./api.js";
import { subscribeConnectionFailure } from "./connection.js";

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

let reported;
let unsubscribe;

beforeEach(() => {
  reported = [];
  unsubscribe = subscribeConnectionFailure((reason) => {
    reported.push(reason);
  });
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
});

// Every request carries the reason it failed for, not just the collections
// load: a notes request is how a dead server is usually discovered after boot.
describe("request connection reason", () => {
  test("an unreachable server flags a load as the server", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(getNotes(7)).rejects.toMatchObject({ reason: "server" });
  });

  test("a database outage flags the database", async () => {
    stubFetch(async () =>
      jsonResponse(503, { error: "Database unavailable." }),
    );

    await expect(getNotes(7)).rejects.toMatchObject({
      reason: "database",
    });
  });

  test("any other server answer stays a screen-local generic failure", async () => {
    stubFetch(async () => jsonResponse(500, { error: "boom" }));

    await expect(getNotes(7)).rejects.toMatchObject({
      reason: "generic",
      message: "boom",
    });
  });

  test("the caller's own abort stays an abort", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    stubFetch(() => Promise.reject(abort));

    await expect(getNotes(7)).rejects.toBe(abort);
  });
});

// Attaching a reason is the API's job; promoting it is the load's. A failed
// save must keep its form and inline error instead of being replaced by the
// shell card mid-edit.
describe("connection failure promotion", () => {
  test("a failed load is left for the screen to promote", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(getNotes(7)).rejects.toMatchObject({ reason: "server" });

    expect(reported).toEqual([]);
  });

  test("a failed mutation never replaces the screen that made it", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));

    await expect(createNote({}, 7)).rejects.toMatchObject({
      reason: "server",
    });

    expect(reported).toEqual([]);
  });
});
