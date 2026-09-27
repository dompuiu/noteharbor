import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot resolve `:hover` from a stylesheet, so the hover rule is
// pinned here as a static contract over the source instead of a rendered
// assertion.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("table styles", () => {
  test("defines the zebra row tint token", () => {
    expect(styles).toMatch(/--row-zebra:\s*rgba\(150,\s*98,\s*47,\s*0\.05\)/);
  });

  test("odd rows carry the zebra tint", () => {
    expect(styles).toMatch(
      /\.table-row-link--zebra\s*\{\s*background:\s*var\(--row-zebra\)/,
    );
  });

  test("sort buttons tint with accent-soft on hover", () => {
    expect(styles).toMatch(
      /\.sort-button:hover\s*\{\s*background:\s*var\(--accent-soft\)/,
    );
  });

  test("sort buttons fill their header cell", () => {
    expect(styles).toMatch(/\.sort-button\s*\{[^}]*width:\s*100%/);
    expect(styles).toMatch(
      /thead tr:first-child th:has\(\.sort-button\)\s*\{\s*padding:\s*0/,
    );
  });
});
