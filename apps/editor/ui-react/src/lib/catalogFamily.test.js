import { describe, expect, test } from "vitest";
import { matchesCatalogFamily } from "./catalogFamily.js";

describe("matchesCatalogFamily", () => {
  test("matches the base number and a single trailing letter", () => {
    expect(matchesCatalogFamily("22", "22")).toBe(true);
    expect(matchesCatalogFamily("22a", "22")).toBe(true);
    expect(matchesCatalogFamily("22b", "22")).toBe(true);
    expect(matchesCatalogFamily("22s", "22")).toBe(true);
  });

  test("never matches a longer number", () => {
    expect(matchesCatalogFamily("220", "22")).toBe(false);
    expect(matchesCatalogFamily("221", "22")).toBe(false);
    expect(matchesCatalogFamily("2200", "22")).toBe(false);
  });

  test("a letters-only base matches every number that starts with it", () => {
    expect(matchesCatalogFamily("M", "M")).toBe(true);
    expect(matchesCatalogFamily("M1", "M")).toBe(true);
    expect(matchesCatalogFamily("M2", "M")).toBe(true);
    expect(matchesCatalogFamily("M10", "M")).toBe(true);
    expect(matchesCatalogFamily("M1a", "M")).toBe(true);
    expect(matchesCatalogFamily("MA", "M")).toBe(true);
  });

  test("a letters-only base still does not match an unrelated number", () => {
    expect(matchesCatalogFamily("N1", "M")).toBe(false);
    expect(matchesCatalogFamily("1M", "M")).toBe(false);
  });

  test("a numeric base with a trailing letter is not a prefix", () => {
    expect(matchesCatalogFamily("22a1", "22a")).toBe(false);
    expect(matchesCatalogFamily("22a-1", "22a")).toBe(false);
    expect(matchesCatalogFamily("22ab", "22a")).toBe(true);
  });

  test("a base that contains a digit keeps the single trailing letter rule", () => {
    expect(matchesCatalogFamily("M1", "M1")).toBe(true);
    expect(matchesCatalogFamily("M1a", "M1")).toBe(true);
    expect(matchesCatalogFamily("M10", "M1")).toBe(false);
  });

  test("does not match a shorter or different number", () => {
    expect(matchesCatalogFamily("2", "22")).toBe(false);
    expect(matchesCatalogFamily("23", "22")).toBe(false);
  });

  test("ignores case and surrounding whitespace", () => {
    expect(matchesCatalogFamily(" 22A ", " 22 ")).toBe(true);
    expect(matchesCatalogFamily("km", "KM")).toBe(true);
  });

  test("an empty query matches everything and an empty catalog matches nothing", () => {
    expect(matchesCatalogFamily("220", "")).toBe(true);
    expect(matchesCatalogFamily("", "22")).toBe(false);
  });
});
