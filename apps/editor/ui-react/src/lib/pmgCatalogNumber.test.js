import { describe, expect, test } from "vitest";

import { extractCatalogNumberFromPmNote } from "./pmgCatalogNumber.js";

describe("extractCatalogNumberFromPmNote", () => {
  test("keeps a catalog prefix that follows the region code", () => {
    expect(extractCatalogNumberFromPmNote("ROMM8", "ROM")).toBe("M8");
  });

  test("keeps a digit after the suffix letter", () => {
    expect(extractCatalogNumberFromPmNote("ROM112a1", "ROM")).toBe("112a1");
  });

  test("returns the catalog number with the region removed", () => {
    expect(extractCatalogNumberFromPmNote("ROM19a", "ROM")).toBe("19a");
  });

  test("strips the region case-insensitively", () => {
    expect(extractCatalogNumberFromPmNote("rom112a1", "rom")).toBe("112a1");
  });

  test("falls back to the digit run when no region is given", () => {
    expect(extractCatalogNumberFromPmNote("ROM112a1")).toBe("112a");
  });

  test("returns null for an empty note", () => {
    expect(extractCatalogNumberFromPmNote("", "ROM")).toBeNull();
    expect(extractCatalogNumberFromPmNote(null, "ROM")).toBeNull();
  });
});
