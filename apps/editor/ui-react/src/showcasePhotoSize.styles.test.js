import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot resolve the shared grid's computed columns, so the photo-size
// grid contract is pinned here over the stylesheet source: the auto-fill grid
// reads its minimum card width from the custom property the control sets.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

// Returns the whole at-rule body (nested rules included) that starts at
// `header`, so the rail's container query contents can be asserted without
// trusting where the file happens to end them.
function atRule(source, header) {
  const start = source.indexOf(header);

  if (start < 0) {
    return null;
  }

  let depth = 0;

  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

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

  // Auto-fill picks the same column count for two rail minimums at many
  // widths, so the rail names a count per size: the row fills, and each size
  // keeps a width of its own.
  test("the Auction rail fills its row with a column count per size", () => {
    const small = styles.match(
      /\.showcase-grid\[data-catalog-layout="rail"\]\[data-photo-size="small"\]\s*\{([^}]*)\}/,
    );
    expect(small).not.toBeNull();
    expect(small[1]).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );

    const singleColumn = styles.match(
      /\.showcase-grid\[data-catalog-layout="rail"\]\[data-photo-size="medium"\],\s*\.showcase-grid\[data-catalog-layout="rail"\]\[data-photo-size="large"\]\s*\{([^}]*)\}/,
    );
    expect(singleColumn).not.toBeNull();
    expect(singleColumn[1]).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  test("the rail's column counts step up with the canvas width", () => {
    const wide = atRule(styles, "@container showcase-shell (min-width: 1320px)");
    expect(wide).not.toBeNull();
    expect(wide).toMatch(
      /\[data-photo-size="small"\]\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(wide).toMatch(
      /\[data-photo-size="medium"\]\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(wide).toMatch(
      /\[data-photo-size="large"\]\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );

    const widest = atRule(styles, "@container showcase-shell (min-width: 1720px)");
    expect(widest).not.toBeNull();
    expect(widest).toMatch(
      /\[data-photo-size="small"\]\s*\{[^}]*repeat\(5,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(widest).toMatch(
      /\[data-photo-size="medium"\]\s*\{[^}]*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(widest).toMatch(
      /\[data-photo-size="large"\]\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  test("the rail's column queries measure the canvas, not the viewport", () => {
    const body = styles.match(
      /\.screen-stack\.showcase-screen > \.screen-body\s*\{([^}]*)\}/,
    );
    expect(body).not.toBeNull();
    expect(body[1]).toMatch(/container-type:\s*inline-size/);
    expect(body[1]).toMatch(/container-name:\s*showcase-shell/);
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
