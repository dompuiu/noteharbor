import { describe, expect, test } from "vitest";
import {
  DEFAULT_CATALOG_LAYOUT,
  normalizeCatalogLayout,
} from "./catalogLayout.js";

describe("the catalog layout preference", () => {
  test("defaults to the Library label and rejects unknown values", () => {
    expect(DEFAULT_CATALOG_LAYOUT).toBe("labels");
    expect(normalizeCatalogLayout(undefined)).toBe("labels");
    expect(normalizeCatalogLayout("gallery")).toBe("labels");
    expect(normalizeCatalogLayout("rail")).toBe("rail");
  });
});
