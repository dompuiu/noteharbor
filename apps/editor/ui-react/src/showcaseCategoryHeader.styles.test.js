import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// The section header reserves a gutter on the right for its `⋯` menu, but the
// rule that closes the title block belongs to the whole section: it crosses
// that gutter instead of stopping at the menu. The gutter is one custom
// property so the header and the rule can never drift apart.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("showcase category header", () => {
  test("the title rule reaches the section's right edge across the menu gutter", () => {
    const gutter = styles.match(
      /--showcase-category-menu-gutter:\s*36px/,
    );
    expect(gutter).not.toBeNull();
    expect(styles).toMatch(
      /padding-right:\s*var\(--showcase-category-menu-gutter\)/,
    );

    const rule = styles.match(/\.showcase-category-rule\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/align-self:\s*stretch/);
    expect(rule[1]).toMatch(
      /margin-right:\s*calc\(-1\s*\*\s*var\(--showcase-category-menu-gutter\)\)/,
    );
  });
});
