import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { downloadArchive } from "./api.js";

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("downloadArchive", () => {
  test("parses the omitted-showcases response header", async () => {
    const header = encodeURIComponent(
      JSON.stringify(["Outside", "Ünicode, name"])
    );
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse({ omittedHeader: header })));

    await expect(downloadArchive([1])).resolves.toEqual({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: ["Outside", "Ünicode, name"],
    });
  });

  test("reports no omitted showcases when the header is absent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => archiveResponse()));

    await expect(downloadArchive([1])).resolves.toEqual({
      filename: "noteharbor-archive-2026-01-01.zip",
      omittedShowcases: [],
    });
  });
});
