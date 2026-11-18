import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot lay a flex row out, so the toolbar's wrapping contract is
// pinned here over the stylesheet source: the three clusters wrap as whole
// groups, each cluster wraps its own controls, and the bar never asks for more
// width than its canvas has.
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

// Returns the whole at-rule body (nested rules included) that starts at
// `header`, so a container query's contents can be asserted without trusting
// where the file happens to end it.
function atRule(source, header) {
  const start = source.indexOf(header);

  if (start < 0) {
    return null;
  }

  let depth = 0;

  for (
    let index = source.indexOf("{", start);
    index < source.length;
    index += 1
  ) {
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

describe("showcase toolbar styles", () => {
  test("the toolbar wraps whole clusters and spaces them by column", () => {
    const bar = styles.match(/\n\.showcase-filter-bar\s*\{([^}]*)\}/);
    expect(bar).not.toBeNull();
    expect(bar[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(bar[1]).toMatch(/gap:\s*8px 12px/);
  });

  test("the view controls keep their own width and wrap inside it", () => {
    const actions = styles.match(/\n\.showcase-filter-actions\s*\{([^}]*)\}/);
    expect(actions).not.toBeNull();
    // `none` keeps CARD LAYOUT / PHOTO SIZE / Slideshow from squeezing each
    // other; the cap is what lets the cluster wrap at the canvas edge.
    expect(actions[1]).toMatch(/flex:\s*none/);
    expect(actions[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(actions[1]).toMatch(/max-width:\s*100%/);
  });

  test("the chips absorb the row's spare width", () => {
    const chips = styles.match(/\n\.showcase-filter-chips\s*\{([^}]*)\}/);
    expect(chips).not.toBeNull();
    // Growth here is what keeps the rail and the view controls at the far
    // end: it spends the free space before either auto margin can split it.
    expect(chips[1]).toMatch(/flex:\s*1 1 auto/);
    expect(chips[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(chips[1]).toMatch(/max-width:\s*100%/);
  });

  test("the owned reading shrinks its meter before it wraps", () => {
    const progress = styles.match(
      /\n\.showcase-filter-progress\s*\{([^}]*)\}/,
    );
    expect(progress).not.toBeNull();
    expect(progress[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(progress[1]).toMatch(/min-width:\s*0/);
    expect(progress[1]).toMatch(/max-width:\s*100%/);

    const meter = styles.match(/\n\.showcase-progress\s*\{([^}]*)\}/);
    expect(meter).not.toBeNull();
    expect(meter[1]).toMatch(/flex:\s*0 1 auto/);
    expect(meter[1]).toMatch(/width:\s*120px/);
    expect(meter[1]).toMatch(/min-width:\s*40px/);
  });

  test("each labeled control can stack its caption over its pill", () => {
    for (const selector of [
      "showcase-layout-control",
      "showcase-photo-size-control",
    ]) {
      const rule = styles.match(
        new RegExp(`\\n\\.${selector}\\s*\\{([^}]*)\\}`),
      );
      expect(rule).not.toBeNull();
      expect(rule[1]).toMatch(/flex-wrap:\s*wrap/);
    }
  });

  test("a wrapped view-control row keeps the bar's right edge", () => {
    const wrapped = atRule(
      styles,
      "@container showcase-shell (max-width: 1322px)",
    );
    expect(wrapped).not.toBeNull();
    expect(wrapped).toMatch(
      /\.showcase-filter-actions\s*\{[^}]*margin-left:\s*auto/,
    );
  });

  test("a phone-width canvas left-aligns every stacked row", () => {
    const narrow = atRule(
      styles,
      "@container showcase-shell (max-width: 600px)",
    );
    expect(narrow).not.toBeNull();
    expect(narrow).toMatch(
      /\.showcase-filter-progress,\s*\.showcase-filter-actions\s*\{[^}]*margin-left:\s*0/,
    );
  });

  // The toolbar follows the canvas (`showcase-shell`), not the window: a
  // pinned rail narrows it while the viewport stays wide. The old phone rule
  // lived on `@media (max-width: 560px)`, which measured the wrong box, so no
  // viewport media block may touch the toolbar.
  test("no viewport media query sizes the toolbar", () => {
    const mediaBlocks = [...styles.matchAll(/@media[^{]*\{/g)].map((match) =>
      atRule(styles.slice(match.index), match[0].replace(/\{$/, "")),
    );
    expect(mediaBlocks.length).toBeGreaterThan(0);

    for (const block of mediaBlocks) {
      expect(block).not.toMatch(/\.showcase-filter-(?:bar|chips|progress|actions)/);
    }
  });
});
