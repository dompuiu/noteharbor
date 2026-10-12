import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot resolve the shared grid's computed columns, so the photo-size
// grid contract is pinned here over the stylesheet source: the auto-fill grid
// reads its minimum card width from the custom property the control sets.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("showcase photo size styles", () => {
  test("the grid auto-fills from the photo-size custom property with a 16px gap", () => {
    const rule = styles.match(/\n\.showcase-grid\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/display:\s*grid/);
    expect(rule[1]).toMatch(
      /grid-template-columns:\s*repeat\(\s*auto-fill,\s*minmax\(var\(--showcase-card-min,\s*200px\),\s*1fr\)\s*\)/,
    );
    expect(rule[1]).toMatch(/gap:\s*16px/);
  });

  test("marks the chosen size with the accent family", () => {
    const rule = styles.match(
      /\.showcase-photo-size-option:has\(input:checked\)\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(rule[1]).toMatch(/color:\s*var\(--accent-strong\)/);
  });
});
