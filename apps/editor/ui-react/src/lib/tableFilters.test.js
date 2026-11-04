import { describe, expect, test } from "vitest";
import { appendConditions, parseFilterInput } from "./tableFilters.js";

function values(field, raw, options) {
  return parseFilterInput(field, raw, options).conditions.map(
    (condition) => `${condition.negated ? "!" : ""}${condition.value}`,
  );
}

function seq(prefix, from, to) {
  return Array.from(
    { length: to - from + 1 },
    (_, index) => `${prefix}${from + index}`,
  );
}

describe("range expansion", () => {
  test("a numeric range becomes one chip per value", () => {
    expect(values("catalog_number", "22-25")).toEqual(["22", "23", "24", "25"]);
  });

  test.each(["M1-M8", "M1-8"])(
    "%s keeps the prefix on every value",
    (raw) => {
      expect(values("catalog_number", raw)).toEqual(seq("M", 1, 8));
    },
  );

  test("a descending pair swaps", () => {
    expect(values("catalog_number", "25-22")).toEqual(["22", "23", "24", "25"]);
  });

  test("zero padding is kept", () => {
    expect(values("catalog_number", "M01-M03")).toEqual(["M01", "M02", "M03"]);
  });

  test("one padded side pads the other to the wider width", () => {
    expect(values("catalog_number", "M01-3")).toEqual(["M01", "M02", "M03"]);
  });

  test("a range rides beside comma-separated values", () => {
    expect(values("grade", "65, 67-69")).toEqual(["65", "67", "68", "69"]);
  });
});

describe("literal fallbacks", () => {
  test.each([
    ["22a-25", ["22a-25"]],
    ["1-2-3", ["1-2-3"]],
    ["Fr. 2300", ["Fr. 2300"]],
    ["12/21/1938", ["12/21/1938"]],
    ["1-M8", ["1-M8"]],
    ["-5", ["-5"]],
    ["1-", ["1-"]],
  ])("%s stays one literal value", (raw, expected) => {
    expect(values("catalog_number", raw)).toEqual(expected);
  });

  test("a caller that cannot refuse gets the text verbatim", () => {
    expect(values("catalog_number", "1-500", { expandRanges: false })).toEqual([
      "1-500",
    ]);
  });
});

describe("negation", () => {
  test("! applies to every value of the range", () => {
    expect(values("catalog_number", "!M1-M3")).toEqual(["!M1", "!M2", "!M3"]);
  });
});

describe("dedupe", () => {
  test("a value already in the range is not added twice", () => {
    expect(values("catalog_number", "M1-M3, M2")).toEqual(["M1", "M2", "M3"]);
  });

  test("dedupe is case-insensitive", () => {
    expect(values("catalog_number", "M1-M2, m2")).toEqual(["M1", "M2"]);
  });

  test("appending keeps the chips already in the rail", () => {
    const current = [{ field: "grade", value: "PMG", negated: false }];
    const incoming = [
      { field: "grade", value: "pmg", negated: false },
      { field: "grade", value: "PCGS", negated: false },
    ];

    expect(appendConditions(current, incoming).map((item) => item.value)).toEqual(
      ["PMG", "PCGS"],
    );
  });
});

describe("the 100 value cap", () => {
  test("a range of exactly 100 values commits", () => {
    const parsed = parseFilterInput("catalog_number", "1-100");

    expect(parsed.tooWide).toBe(false);
    expect(parsed.conditions).toHaveLength(100);
  });

  test("a wider range refuses the whole commit", () => {
    expect(parseFilterInput("catalog_number", "1-101, M1")).toEqual({
      conditions: [],
      tooWide: true,
    });
  });

  test("a wide numeric range is refused rather than read literally", () => {
    expect(parseFilterInput("serial", "1000-2000").tooWide).toBe(true);
  });
});

describe("parseFilterInput", () => {
  test("an empty input parses to nothing", () => {
    expect(parseFilterInput("tags", "  ,  ")).toEqual({
      conditions: [],
      tooWide: false,
    });
  });
});
