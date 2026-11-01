import { describe, expect, test } from "vitest";
import {
  parseDenominationValue,
  parseGradeValue,
  parseNoteDate,
} from "./tableColumns.js";

// The printed text is what the collector reads; these values are what the
// table orders on. A column that reads as a date or a number must never be
// sorted as a string: `1917` and `01/01/1917` are the same year, and
// `1,000 Lei` is ten times `100 Lei`, not a word beginning with "1,0".
describe("parseNoteDate", () => {
  test("reads the stored month-first dates", () => {
    expect(parseNoteDate("01/01/1917")).toBe(19170101);
    expect(parseNoteDate("12/21/1938")).toBe(19381221);
    expect(parseNoteDate("05/13/1893")).toBe(18930513);
  });

  test("places a year-only value at the start of that year", () => {
    expect(parseNoteDate("1917")).toBe(19170101);
    expect(parseNoteDate("1917")).toBeLessThan(parseNoteDate("12/21/1917"));
  });

  test("accepts ISO dates", () => {
    expect(parseNoteDate("1938-12-21")).toBe(19381221);
  });

  test("returns null for what it cannot read", () => {
    expect(parseNoteDate("")).toBeNull();
    expect(parseNoteDate("circa 1917")).toBeNull();
    expect(parseNoteDate("13/45/1917")).toBeNull();
    expect(parseNoteDate(undefined)).toBeNull();
  });
});

describe("parseDenominationValue", () => {
  test("compares denominations in the same unit", () => {
    // Bani are a hundredth of a leu: comparing printed amounts alone would
    // put 25 Bani above 1 Leu.
    const ascending = ["25 Bani", "1 Leu", "5 Lei", "100 Lei", "1,000 Lei"];
    const values = ascending.map(parseDenominationValue);
    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  test("reads a thousands separator as a thousands separator", () => {
    expect(parseDenominationValue("1,000 Lei")).toBe(100000);
    expect(parseDenominationValue("100 Lei")).toBe(10000);
  });

  test("returns null for something that is not a denomination", () => {
    expect(parseDenominationValue("")).toBeNull();
    expect(parseDenominationValue("Uncut sheet")).toBeNull();
  });
});

describe("parseGradeValue", () => {
  test("reads the numeric part of a grade", () => {
    expect(parseGradeValue("66 EPQ")).toBe(66);
    expect(parseGradeValue("65")).toBe(65);
    expect(parseGradeValue("Choice UNC 63")).toBe(63);
    expect(parseGradeValue("58 EPQ")).toBe(58);
  });

  test("returns null when a grade carries no number", () => {
    expect(parseGradeValue("")).toBeNull();
    expect(parseGradeValue("Uncirculated")).toBeNull();
  });
});
