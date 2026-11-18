import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { exportArchive } from "./api.js";

function archiveResponse({ omittedHeader = null } = {}) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["zip"]),
    headers: {
      get(name) {
        if (name === "content-disposition") {
          return 'attachment; filename="noteharbor-archive-2026-01-01.zip"';
        }
        if (name === "x-noteharbor-omitted-showcases") {
          return omittedHeader;
        }
        return null;
      },
    },
  };
}

beforeEach(() => {
  window.URL.createObjectURL = vi.fn(() => "blob:mock");
  window.URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  delete window.noteHarborDesktop;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("exportArchive", () => {
  test("saves through the desktop shell without a browser download", async () => {
    const saveArchive = vi.fn(async () => ({
      filename: "noteharbor-archive-2026-01-01.zip",
      path: "/home/collector/Downloads/noteharbor-archive-2026-01-01.zip",
      omittedShowcases: ["Outside Show"],
    }));
    window.noteHarborDesktop = { exportArchive: saveArchive };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportArchive([1, 2], [10])).resolves.toEqual({
      filename: "noteharbor-archive-2026-01-01.zip",
      path: "/home/collector/Downloads/noteharbor-archive-2026-01-01.zip",
      omittedShowcases: ["Outside Show"],
    });
    expect(saveArchive).toHaveBeenCalledWith([1, 2], [10]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  test("passes a cancelled save dialog through as null", async () => {
    window.noteHarborDesktop = { exportArchive: vi.fn(async () => null) };

    await expect(exportArchive([1], [])).resolves.toBeNull();
  });

  test("falls back to the browser download when the bridge is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse()));

    await expect(exportArchive([1])).resolves.toEqual({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: [],
    });
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  test("parses the omitted-showcases response header", async () => {
    const header = encodeURIComponent(
      JSON.stringify(["Outside", "Ünicode, name"]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => archiveResponse({ omittedHeader: header })),
    );

    await expect(exportArchive([1])).resolves.toEqual({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: ["Outside", "Ünicode, name"],
    });
  });

  test("sends the selected showcase ids", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse()));
    const fetchMock = globalThis.fetch;

    await exportArchive([1, 2], [10, 11]);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("collectionIds=1%2C2");
    expect(url).toContain("showcaseIds=10%2C11");
  });

  test("sends an explicit empty showcase selection apart from no filter", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse()));
    const fetchMock = globalThis.fetch;

    await exportArchive([1], []);

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("showcaseIds=");
  });

  test("omits the showcase filter when no selection is given", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse()));
    const fetchMock = globalThis.fetch;

    await exportArchive([1]);

    const url = fetchMock.mock.calls[0][0];
    expect(url).not.toContain("showcaseIds");
  });
});
