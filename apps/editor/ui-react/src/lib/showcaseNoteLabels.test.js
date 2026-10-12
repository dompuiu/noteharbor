import { describe, expect, test } from "vitest";
import {
  formatShowcaseCatalogNumber,
  showcaseNoteDisplayParts,
} from "./showcaseNoteLabels.js";

describe("formatShowcaseCatalogNumber", () => {
  test("prefixes a bare number with Pick", () => {
    expect(formatShowcaseCatalogNumber("17")).toBe("Pick 17");
  });

  test("keeps the family suffix after the prefix", () => {
    expect(formatShowcaseCatalogNumber("22a")).toBe("Pick 22a");
  });

  test("normalizes an existing prefix instead of doubling it", () => {
    expect(formatShowcaseCatalogNumber("P17")).toBe("Pick 17");
    expect(formatShowcaseCatalogNumber("p22a")).toBe("Pick 22a");
    expect(formatShowcaseCatalogNumber("Pick 17")).toBe("Pick 17");
    expect(formatShowcaseCatalogNumber("Pick17")).toBe("Pick 17");
  });

  test("trims and drops empty values", () => {
    expect(formatShowcaseCatalogNumber("  17  ")).toBe("Pick 17");
    expect(formatShowcaseCatalogNumber("")).toBe("");
    expect(formatShowcaseCatalogNumber(null)).toBe("");
  });
});

describe("showcaseNoteDisplayParts", () => {
  test("orders denomination, catalog, and date", () => {
    expect(
      showcaseNoteDisplayParts({
        denomination: "1 leu",
        catalog_number: "17",
        issue_date: "1917",
      }),
    ).toEqual(["1 leu", "Pick 17", "1917"]);
  });

  test("omits missing parts", () => {
    expect(
      showcaseNoteDisplayParts({ denomination: "1 leu", issue_date: "1917" }),
    ).toEqual(["1 leu", "1917"]);
  });
});
