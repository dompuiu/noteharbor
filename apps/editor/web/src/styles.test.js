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

  test("sort buttons span their header cell width", () => {
    expect(styles).toMatch(/\.sort-button\s*\{[^}]*width:\s*100%/);
    expect(styles).not.toMatch(/th:has\(\.sort-button\)/);
  });

  test("the sorted column stands out in accent-strong", () => {
    expect(styles).toMatch(
      /\.sort-button--active\s*\{\s*color:\s*var\(--accent-strong\)/,
    );
  });

  test("a filled column filter stands out with the accent border", () => {
    expect(styles).toMatch(/\.filter-input--active/);
    expect(styles).toMatch(
      /\.tags-filter-combobox:has\(\.tags-filter-chip\)/,
    );
  });

  // The Clear all affordance sits inside the tags filter; hovering it should
  // stay in the warm accent family rather than snapping to near-black text.
  test("clear-all hover stays in the accent family", () => {
    const rule = styles.match(/\.tags-filter-clear-all:hover\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(rule[1]).not.toMatch(/var\(--text\)/);
  });

  // A filter that gains a value must keep the same surface as an empty one:
  // the accent border marks it filled, and the field never changes colour as
  // the user types. Locking this in stops the tint from creeping back.
  test("a filled column filter marks itself with the border only", () => {
    const rule = styles.match(/\.filter-input--active[^{]*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    // The tags combobox keys off the same rule.
    expect(rule[0]).toMatch(/\.tags-filter-combobox:has\(\.tags-filter-chip\)/);
    expect(rule[1]).toMatch(/border-color:\s*var\(--accent\)/);
    // No fill property at all (background / background-color).
    expect(rule[1]).not.toMatch(/^\s*background(?:-color)?\s*:/m);
  });

  test("label-row headers use heavy wide-tracked caps", () => {
    expect(styles).toMatch(
      /thead tr:first-child th\s*\{[^}]*font-weight:\s*800/,
    );
  });
});

describe("sidebar styles", () => {
  test("defines the collapsed rail and expanded widths", () => {
    expect(styles).toMatch(/--sidebar-rail-width:\s*64px/);
    expect(styles).toMatch(/--sidebar-expanded-width:\s*288px/);
    expect(styles).toMatch(
      /\.sidebar\s*\{[^}]*width:\s*var\(--sidebar-rail-width\)/,
    );
    expect(styles).toMatch(
      /\.sidebar-dock--pinned\s*\{[^}]*width:\s*var\(--sidebar-expanded-width\)/,
    );
  });

  test("expands on hover and on keyboard focus entering the rail", () => {
    expect(styles).toMatch(
      /\.sidebar-dock:not\(\.sidebar-dock--pinned\):hover\s+\.sidebar/,
    );
    expect(styles).toMatch(
      /\.sidebar-dock:not\(\.sidebar-dock--pinned\):has\(:focus-visible\)\s+\.sidebar/,
    );
  });

  test("the reduced-motion block drops the sidebar transition", () => {
    const block = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.sidebar[\s,{]/);
    expect(block[1]).toMatch(/transition:\s*none/);
  });

  // jsdom does not hit-test, so the drawer's stacking and its tab order are
  // pinned here. The dock must not create a stacking context, or it traps the
  // drawer's z-index below the sibling backdrop.
  test("the drawer stacks above its backdrop", () => {
    const dock = styles.match(/\.sidebar-dock\s*\{([^}]*)\}/);
    expect(dock).not.toBeNull();
    expect(dock[1]).not.toMatch(/z-index/);

    const drawerZ = Number(
      styles.match(
        /\.sidebar,\s*\n\s*\.sidebar-dock--pinned \.sidebar\s*\{([^}]*)\}/,
      )?.[1].match(/z-index:\s*(\d+)/)?.[1],
    );
    const backdropZ = Number(
      styles.match(/\.sidebar-backdrop\s*\{[^}]*z-index:\s*(\d+)/)?.[1],
    );
    expect(drawerZ).toBeGreaterThan(backdropZ);
  });

  test("the closed drawer is hidden from the tab order", () => {
    const closedDrawer = styles.match(
      /\.sidebar,\s*\n\s*\.sidebar-dock--pinned \.sidebar\s*\{([^}]*)\}/,
    );
    expect(closedDrawer).not.toBeNull();
    expect(closedDrawer[1]).toMatch(/visibility:\s*hidden/);
  });
});
