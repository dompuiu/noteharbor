import { afterEach, describe, expect, test, vi } from "vitest";
import { getHealth } from "./api.js";

function stubFetch(implementation) {
  vi.stubGlobal("fetch", vi.fn(implementation));
}

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getHealth", () => {
  test("reports the server as unreachable when fetch rejects", async () => {
    stubFetch(() => Promise.reject(new Error("connection refused")));

    await expect(getHealth()).resolves.toEqual({
      connected: false,
      reason: "server",
    });
  });

  test("reports the database when the server answers 503", async () => {
    stubFetch(async () => jsonResponse(503, { ok: false }));

    await expect(getHealth()).resolves.toEqual({
      connected: false,
      reason: "database",
    });
  });

  test("reports a generic problem for other non-200 responses", async () => {
    stubFetch(async () => jsonResponse(500, { ok: false }));

    await expect(getHealth()).resolves.toEqual({
      connected: false,
      reason: "generic",
    });
  });

  test("reports connected on a clean 200 with ok:true", async () => {
    stubFetch(async () => jsonResponse(200, { ok: true }));

    await expect(getHealth()).resolves.toEqual({ connected: true });
  });

  test("reports a generic problem when a 200 lacks ok:true", async () => {
    stubFetch(async () => jsonResponse(200, {}));

    await expect(getHealth()).resolves.toEqual({
      connected: false,
      reason: "generic",
    });
  });

  test("does not treat another 2xx as connected", async () => {
    stubFetch(async () => jsonResponse(201, { ok: true }));

    await expect(getHealth()).resolves.toEqual({
      connected: false,
      reason: "generic",
    });
  });
});
