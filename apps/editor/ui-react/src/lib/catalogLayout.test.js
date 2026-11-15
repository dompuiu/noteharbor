import { describe, expect, test } from "vitest";
import {
  CATALOG_LAYOUT_RAIL_MIN_WIDTH,
  DEFAULT_CATALOG_LAYOUT,
  minWidthForCatalogLayout,
  normalizeCatalogLayout,
} from "./catalogLayout.js";

describe("the catalog layout preference", () => {
  test("defaults to the Library label and rejects unknown values", () => {
    expect(DEFAULT_CATALOG_LAYOUT).toBe("labels");
    expect(normalizeCatalogLayout(undefined)).toBe("labels");
    expect(normalizeCatalogLayout("gallery")).toBe("labels");
    expect(normalizeCatalogLayout("rail")).toBe("rail");
  });

  test("keeps the photo size width for the Library label", () => {
    expect(minWidthForCatalogLayout("labels", "small")).toBe(200);
    expect(minWidthForCatalogLayout("labels", "medium")).toBe(320);
    expect(minWidthForCatalogLayout("labels", "large")).toBe(480);
  });

  test("floors the Auction rail at its fixed identity column", () => {
    expect(CATALOG_LAYOUT_RAIL_MIN_WIDTH).toBe(330);
    expect(minWidthForCatalogLayout("rail", "small")).toBe(330);
    expect(minWidthForCatalogLayout("rail", "medium")).toBe(330);
    expect(minWidthForCatalogLayout("rail", "large")).toBe(480);
  });
});
