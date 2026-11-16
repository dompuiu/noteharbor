import { describe, expect, test } from "vitest";
import { minWidthForPhotoSize, normalizePhotoSize } from "./photoSize.js";

describe("the showcase photo size", () => {
  test("maps each size to its grid minimum", () => {
    expect(minWidthForPhotoSize("small")).toBe(200);
    expect(minWidthForPhotoSize("medium")).toBe(320);
    expect(minWidthForPhotoSize("large")).toBe(480);
  });

  test("falls back to Small for an unknown size", () => {
    expect(normalizePhotoSize("gigantic")).toBe("small");
    expect(minWidthForPhotoSize("gigantic")).toBe(200);
  });
});
