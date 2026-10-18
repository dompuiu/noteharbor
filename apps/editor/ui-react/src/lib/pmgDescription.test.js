import { describe, expect, test } from "vitest";
import { extractPmgDescriptionFields } from "./pmgDescription.js";

describe("extractPmgDescriptionFields", () => {
  test("keeps thousands separators in the denomination", () => {
    expect(
      extractPmgDescriptionFields(
        "Romania, Banca Nationala, 500,000 Lei 2000-04 - Wmk: A. Vlaicu",
      ),
    ).toEqual({ denomination: "500,000 Lei", issueDate: "2000-04" });
  });

  test("parses plain denominations and years", () => {
    expect(extractPmgDescriptionFields("China, 1 Yuan 1936")).toEqual({
      denomination: "1 Yuan",
      issueDate: "1936",
    });
    expect(
      extractPmgDescriptionFields("Romania, Banca Nationala, 500 Lei 2000"),
    ).toEqual({ denomination: "500 Lei", issueDate: "2000" });
  });

  test("parses ND dates and strips SPECIMEN", () => {
    expect(
      extractPmgDescriptionFields("Germany, Reichsbank, 100 Mark ND (1935)"),
    ).toEqual({ denomination: "100 Mark", issueDate: "1935" });
    expect(
      extractPmgDescriptionFields('Turkey, 1000 Lire "SPECIMEN" 1970'),
    ).toEqual({ denomination: "1000 Lire", issueDate: "1970" });
  });

  test("parses denominations with a trailing sheet qualifier", () => {
    expect(
      extractPmgDescriptionFields(
        "Romania, Banca Nationala, 10,000 Lei 2000 - Sheet of 4",
      ),
    ).toEqual({ denomination: "10,000 Lei", issueDate: "2000" });
  });

  test("returns empty fields for blank input", () => {
    expect(extractPmgDescriptionFields("")).toEqual({});
    expect(extractPmgDescriptionFields(null)).toEqual({});
  });
});
