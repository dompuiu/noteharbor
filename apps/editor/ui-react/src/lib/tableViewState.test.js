import { beforeEach, describe, expect, test } from "vitest";
import {
  defaultVisibleColumnKeysFor,
  keepsADataColumnIn,
  lastVisibleDataColumnKeyIn,
  normalizeVisibleColumnKeysFor,
  readStoredTableState,
  writeStoredTableState,
} from "./tableViewState.js";

const columns = [
  { key: "thumbnail", hideable: false, kind: "data" },
  { key: "catalog", hideable: true, kind: "data" },
  { key: "denomination", hideable: true, kind: "data" },
  { key: "grade", hideable: true, kind: "data" },
];

describe("tableViewState", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test("defaults to the hideable columns in model order", () => {
    expect(defaultVisibleColumnKeysFor(columns)).toEqual([
      "catalog",
      "denomination",
      "grade",
    ]);
  });

  test("drops unknown keys and keeps the model order", () => {
    expect(
      normalizeVisibleColumnKeysFor(columns, [
        "grade",
        "missing",
        "catalog",
      ]),
    ).toEqual(["catalog", "grade"]);
  });

  test("falls back when no data column would remain", () => {
    expect(normalizeVisibleColumnKeysFor(columns, ["missing"])).toEqual([
      "catalog",
      "denomination",
      "grade",
    ]);
    expect(normalizeVisibleColumnKeysFor(columns, null)).toEqual([
      "catalog",
      "denomination",
      "grade",
    ]);
  });

  test("knows when a saved list keeps a data column", () => {
    expect(keepsADataColumnIn(columns, ["catalog"])).toBe(true);
    expect(keepsADataColumnIn(columns, ["missing"])).toBe(false);
  });

  test("names the last visible data column only when it is alone", () => {
    expect(lastVisibleDataColumnKeyIn(columns, ["catalog"])).toBe("catalog");
    expect(
      lastVisibleDataColumnKeyIn(columns, ["catalog", "grade"]),
    ).toBe(null);
  });

  test("round-trips a stored record and removes invalid JSON", () => {
    writeStoredTableState("test.table", { visibleColumnKeys: ["catalog"] });

    expect(readStoredTableState("test.table")).toEqual({
      visibleColumnKeys: ["catalog"],
    });

    window.localStorage.setItem("test.broken", "{not json");

    expect(readStoredTableState("test.broken")).toBe(null);
    expect(window.localStorage.getItem("test.broken")).toBe(null);
  });
});
