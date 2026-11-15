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

  test("marks the chosen size with the surface disc and its own ring", () => {
    const rule = styles.match(
      /\.showcase-photo-size-option:has\(input:checked\)\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/background:\s*var\(--surface\)/);
    expect(rule[1]).toMatch(
      /box-shadow:\s*inset 0 0 0 1px var\(--border-control\)/,
    );
  });

  test("draws each option as a pill-sized disc in one pill", () => {
    const rule = styles.match(/\n\.showcase-photo-size-option\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/width:\s*28px/);
    expect(rule[1]).toMatch(/height:\s*28px/);
    expect(rule[1]).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });

  // A Small card is 200px wide at its narrowest, so its title bar has to give
  // the caption more of that width or the denomination falls off the end.
  test("tightens the card title's inset on a Small grid", () => {
    const rule = styles.match(
      /\.showcase-grid\[data-photo-size="small"\] \.showcase-reorder-title\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/right:\s*32px/);
    expect(rule[1]).toMatch(/left:\s*32px/);
  });
});
