import { describe, expect, test } from "vitest";
import {
  defaultSortKey,
  filterColumnKeys,
  getTableColumn,
  hideableColumnKeys,
  hideableColumns,
  hideableDataColumns,
  matchesSearchQuery,
  normalizeDenominationFilterValue,
  searchColumnKeys,
  slideshowFilterKeys,
  sortableColumnKeys,
  tableColumns,
  validSortKeys,
} from "./tableColumns.js";

describe("table column model", () => {
  test("describes every column once, in render order", () => {
    expect(tableColumns.map((column) => column.key)).toEqual([
      "reorder",
      "selection",
      "id",
      "thumbnail",
      "catalog_number",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
      "actions",
    ]);
    expect(tableColumns.map((column) => column.label)).toEqual([
      "",
      "",
      "ID",
      "FRONT",
      "Catalog #",
      "Denomination",
      "Date",
      "Company",
      "Grade",
      "Serial",
      "Tags",
      "ACTIONS",
    ]);
    expect(new Set(tableColumns.map((column) => column.key)).size).toBe(
      tableColumns.length,
    );
  });

  test("keeps today's filter columns and their match modes", () => {
    expect(filterColumnKeys).toEqual([
      "catalog_number",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
    ]);

    expect(getTableColumn("catalog_number")).toMatchObject({
      matchMode: "catalogPrefix",
      multiple: true,
      normalize: null,
      isTags: false,
    });
    expect(getTableColumn("denomination")).toMatchObject({
      matchMode: "includes",
      multiple: true,
      normalize: normalizeDenominationFilterValue,
      isTags: false,
    });
    expect(getTableColumn("issue_date").multiple).toBe(true);
    expect(getTableColumn("grade").multiple).toBe(true);
    expect(getTableColumn("grading_company")).toMatchObject({
      matchMode: "includes",
      multiple: false,
      normalize: null,
      isTags: false,
    });
    expect(getTableColumn("serial")).toMatchObject({
      matchMode: "includes",
      multiple: false,
      normalize: null,
      isTags: false,
    });
    expect(getTableColumn("tags").isTags).toBe(true);

    for (const key of ["reorder", "selection", "id", "thumbnail", "actions"]) {
      expect(getTableColumn(key)).toMatchObject({
        filterable: false,
        matchMode: null,
        slideshowFilter: false,
      });
    }
  });

  test("sorts by the display-order id plus the data columns", () => {
    expect(sortableColumnKeys).toEqual([
      "id",
      "catalog_number",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
    ]);
    expect(validSortKeys.has("id")).toBe(true);
    expect(validSortKeys.has("thumbnail")).toBe(false);
    expect(validSortKeys.has("reorder")).toBe(false);
    expect(getTableColumn("id").kind).toBe("order");
    expect(defaultSortKey).toBe("id");
  });

  test("shares the slideshow filter parameters with the filter columns", () => {
    expect(slideshowFilterKeys).toEqual(filterColumnKeys);
    for (const key of slideshowFilterKeys) {
      expect(getTableColumn(key).slideshowFilter).toBe(true);
    }
  });

  test("derives the picker's choices from hideable metadata", () => {
    expect(hideableColumns).toEqual(
      tableColumns.filter((column) => column.hideable),
    );
    expect(hideableColumnKeys).toEqual([
      "id",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
    ]);
    // The permanent catalog column is data but not a choice; the one-column
    // floor applies to the field columns the collector can hide.
    expect(hideableDataColumns.map((column) => column.key)).toEqual([
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
    ]);
  });

  test("marks which columns pin and which stay permanent", () => {
    expect(
      tableColumns.filter((column) => column.sticky).map((column) => column.key),
    ).toEqual(["selection", "thumbnail", "catalog_number"]);
    expect(
      tableColumns
        .filter((column) => !column.hideable)
        .map((column) => column.key),
    ).toEqual([
      "reorder",
      "selection",
      "thumbnail",
      "catalog_number",
      "actions",
    ]);
  });
});

describe("matchesSearchQuery", () => {
  const searchNote = {
    id: 7,
    display_order: 7,
    serial: "SER-9001",
    catalog_number: "Fr. 2300",
    denomination: "Two Dollars",
    grading_company: "PMG",
    grade: "65 EPQ",
    issue_date: "1917",
    tags: [{ id: 1, name: "star note" }, { id: 2, name: "large size" }],
  };

  test("searches every data column and tag names", () => {
    expect(searchColumnKeys).toEqual([
      "catalog_number",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
      "tags",
    ]);

    for (const query of [
      "9001",
      "2300",
      "two dollars",
      "pmg",
      "65 epq",
      "1917",
      "STAR NOTE",
    ]) {
      expect(matchesSearchQuery(searchNote, query)).toBe(true);
    }
  });

  test("is case-insensitive and substring-based", () => {
    expect(matchesSearchQuery(searchNote, "fr. 2300")).toBe(true);
    expect(matchesSearchQuery(searchNote, "2300")).toBe(true);
    expect(matchesSearchQuery(searchNote, "  2300  ")).toBe(true);
  });

  test("rejects a note that matches none of the fields", () => {
    expect(matchesSearchQuery(searchNote, "silver certificate")).toBe(false);
  });

  test("an empty query keeps every note", () => {
    expect(matchesSearchQuery(searchNote, "")).toBe(true);
    expect(matchesSearchQuery(searchNote, "   ")).toBe(true);
    expect(matchesSearchQuery(searchNote, null)).toBe(true);
  });

  test("matches tag names without matching tag ids", () => {
    expect(matchesSearchQuery(searchNote, "star")).toBe(true);
    expect(matchesSearchQuery(searchNote, "large size")).toBe(true);
    expect(matchesSearchQuery(searchNote, "1,2")).toBe(false);
  });
});

describe("normalizeDenominationFilterValue", () => {
  test("adds the thousands separators the stored values carry", () => {
    expect(normalizeDenominationFilterValue("2300")).toBe("2,300");
    expect(normalizeDenominationFilterValue("1234567.50")).toBe(
      "1,234,567.50",
    );
    expect(normalizeDenominationFilterValue(" 1000 ")).toBe("1,000");
  });

  test("leaves values it cannot normalise alone", () => {
    expect(normalizeDenominationFilterValue("$5")).toBe("$5");
    expect(normalizeDenominationFilterValue("")).toBe("");
    expect(normalizeDenominationFilterValue(null)).toBe("");
  });
});
