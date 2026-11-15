import { describe, expect, test } from "vitest";
import {
  formatShowcaseCatalogNumber,
  showcaseNoteDisplayParts,
  showcaseNoteTitleParts,
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

  test("compact shortens the prefix for a small card", () => {
    expect(formatShowcaseCatalogNumber("17", { compact: true })).toBe("P17");
    expect(formatShowcaseCatalogNumber("22a", { compact: true })).toBe("P22a");
    expect(formatShowcaseCatalogNumber("Pick 22a", { compact: true })).toBe(
      "P22a",
    );
    expect(formatShowcaseCatalogNumber("p22a", { compact: true })).toBe("P22a");
    expect(formatShowcaseCatalogNumber("", { compact: true })).toBe("");
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

describe("showcaseNoteTitleParts", () => {
  test("leads with the catalog number, then the date, then the denomination", () => {
    expect(
      showcaseNoteTitleParts({
        denomination: "1 Leu",
        catalog_number: "17",
        issue_date: "03/12/1915",
      }),
    ).toEqual(["Pick 17", "03/12/1915", "1 Leu"]);
  });

  test("compacts the Pick prefix to P for a small card", () => {
    expect(
      showcaseNoteTitleParts(
        {
          denomination: "1 Leu",
          catalog_number: "17",
          issue_date: "03/12/1915",
        },
        { compact: true },
      ),
    ).toEqual(["P17", "03/12/1915", "1 Leu"]);
  });

  test("omits missing parts and needs no catalog value", () => {
    expect(
      showcaseNoteTitleParts({ denomination: "1 leu", issue_date: "1917" }),
    ).toEqual(["1917", "1 leu"]);
    expect(showcaseNoteTitleParts({ denomination: "1 leu" })).toEqual(["1 leu"]);
  });
});
