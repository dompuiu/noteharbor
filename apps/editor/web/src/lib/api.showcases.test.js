import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createShowcase,
  deleteShowcase,
  getShowcases,
  renameShowcase,
  reorderShowcases,
} from "./api.js";

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

describe("showcase API calls", () => {
  test("getShowcases reads the list", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { showcases: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getShowcases()).resolves.toEqual({ showcases: [] });
    expect(fetchMock).toHaveBeenCalledWith("/api/showcases");
  });

  test("createShowcase posts without a name so the server picks the default", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { showcase: { id: 4, name: "Showcase" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createShowcase()).resolves.toEqual({
      showcase: { id: 4, name: "Showcase" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/showcases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  test("createShowcase sends a name when one is given", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { showcase: { id: 5, name: "Summer" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createShowcase("Summer");

    expect(fetchMock).toHaveBeenCalledWith("/api/showcases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Summer" }),
    });
  });

  test("renameShowcase PUTs the new name to the showcase", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { showcase: { id: 2, name: "Winter" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(renameShowcase(2, "Winter")).resolves.toEqual({
      showcase: { id: 2, name: "Winter" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/showcases/2", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Winter" }),
    });
  });

  test("deleteShowcase DELETEs the showcase", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteShowcase(3)).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/showcases/3", {
      method: "DELETE",
    });
  });

  test("reorderShowcases PUTs the full id order", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { showcases: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await reorderShowcases([2, 1, 3]);

    expect(fetchMock).toHaveBeenCalledWith("/api/showcases/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [2, 1, 3] }),
    });
  });
});
