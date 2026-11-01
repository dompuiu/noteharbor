import { describe, expect, test } from "vitest";
import { compileHighlightTerms, highlightTerms } from "./tableCells.jsx";

// The table marks the terms a row matched in every cell of every row, so the
// pattern has to be built once per query rather than once per cell.
describe("highlight terms", () => {
  test("one query compiles one pattern for every cell that marks it", () => {
    const terms = ["silver", "proof"];
    const compiled = compileHighlightTerms(terms);
    const cells = Array.from({ length: 200 }, (_, index) => `NOTE-${index}`);

    for (const cell of cells) {
      highlightTerms(cell, terms);
    }

    // Same matcher object, so no cell recompiled the query.
    expect(compileHighlightTerms([...terms])).toBe(compiled);
  });

  test("empty marks short-circuit without compiling a pattern", () => {
    expect(compileHighlightTerms([])).toBeNull();
    expect(compileHighlightTerms(undefined)).toBeNull();
    expect(highlightTerms("NOTE-1", [])).toBe("NOTE-1");
    expect(highlightTerms("NOTE-1", undefined)).toBe("NOTE-1");
  });

  test("marks every matching term, longest first and case-insensitively", () => {
    const marked = highlightTerms("Silver Proof silver", ["silver", "proof"]);
    const markedParts = marked.filter(
      (part) => typeof part !== "string" && part.type === "mark",
    );

    expect(markedParts.map((part) => part.props.children)).toEqual([
      "Silver",
      "Proof",
      "silver",
    ]);
  });

  test("a term with regex punctuation is matched literally", () => {
    const marked = highlightTerms("A.1773 0862", ["A.1773"]);
    const markedParts = marked.filter(
      (part) => typeof part !== "string" && part.type === "mark",
    );

    expect(markedParts).toHaveLength(1);
    expect(markedParts[0].props.children).toBe("A.1773");
  });

  test("a cell with no match comes back as its plain text", () => {
    expect(highlightTerms("PMG 66", ["PCGS"])).toBe("PMG 66");
  });
});
