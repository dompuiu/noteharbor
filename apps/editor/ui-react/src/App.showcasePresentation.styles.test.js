import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot evaluate `prefers-reduced-motion`, so the note card's swap
// motion is pinned here over the stylesheet source: the two faces cross-fade,
// and the reduced-motion block drops that transition (presentation spec §8).
const styles = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

describe("showcase empty-state styles", () => {
  test("the empty box is a dashed container with centered copy", () => {
    const box = styles.match(/\n\.showcase-empty-box\s*\{([^}]*)\}/);
    expect(box).not.toBeNull();
    expect(box[1]).toMatch(/border:\s*2px\s+dashed/);
    expect(box[1]).toMatch(/text-align:\s*center/);
  });

  test("the empty box middle-centers its copy and action", () => {
    const box = styles.match(/\n\.showcase-empty-box\s*\{([^}]*)\}/);
    expect(box).not.toBeNull();
    expect(box[1]).toMatch(/display:\s*flex/);
    expect(box[1]).toMatch(/flex-direction:\s*column/);
    expect(box[1]).toMatch(/align-items:\s*center/);
    expect(box[1]).toMatch(/justify-content:\s*center/);
    expect(box[1]).toMatch(/gap:\s*\d/);
  });

  test("a filtered empty level is a quiet notice, not a dashed drop zone", () => {
    const quiet = styles.match(/\n\.showcase-empty-box--quiet\s*\{([^}]*)\}/);
    expect(quiet).not.toBeNull();
    expect(quiet[1]).not.toMatch(/dashed/);
    expect(quiet[1]).toMatch(/border:\s*1px solid var\(--border-soft\)/);
  });

  test("the add affordances are flat ghost surfaces, not dashed placeholders", () => {
    const ghost = styles.match(/\n\.showcase-ghost-add\s*\{([^}]*)\}/);
    expect(ghost).not.toBeNull();
    expect(ghost[1]).toMatch(/border:\s*1px solid var\(--border-soft\)/);
    expect(ghost[1]).toMatch(/background:\s*var\(--surface\)/);
    expect(ghost[1]).toMatch(/flex-direction:\s*column/);
    expect(ghost[1]).not.toMatch(/dashed/);
  });

  test("the ghost plus sits in a circle and fills red on hover", () => {
    const plus = styles.match(/\n\.showcase-ghost-add-plus\s*\{([^}]*)\}/);
    expect(plus).not.toBeNull();
    expect(plus[1]).toMatch(/width:\s*34px/);
    expect(plus[1]).toMatch(/height:\s*34px/);
    expect(plus[1]).toMatch(/border-radius:\s*50%/);
    expect(styles).toMatch(
      /\.showcase-ghost-add:hover \.showcase-ghost-add-plus\s*\{[^}]*background:\s*var\(--accent-strong\)/,
    );
  });

  test("the root and empty-state variants read as one-line bars", () => {
    const bars = styles.match(
      /\.showcase-ghost-add--bar,\s*\n\.showcase-ghost-add--centered\s*\{([^}]*)\}/,
    );
    expect(bars).not.toBeNull();
    expect(bars[1]).toMatch(/flex-direction:\s*row/);
    expect(bars[1]).toMatch(/min-height:\s*56px/);
    expect(bars[1]).toMatch(/text-align:\s*left/);
  });

  test("the centered ghost bar matches the empty-state button width", () => {
    const centered = [
      ...styles.matchAll(/\n\.showcase-ghost-add--centered\s*\{([^}]*)\}/g),
    ].at(-1);
    expect(centered).toBeDefined();
    expect(centered[1]).toMatch(/max-width:\s*320px/);
    expect(centered[1]).toMatch(/margin:\s*0\s+auto/);
    expect(centered[1]).toMatch(/justify-content:\s*center/);
    expect(centered[1]).toMatch(/text-align:\s*center/);
  });
});

describe("showcase note/grouping card heights", () => {
  test("the folio header takes the catalog card's top-line metrics", () => {
    const head = styles.match(/\n\.showcase-grouping-head\s*\{([^}]*)\}/);
    const grip = styles.match(
      /\n\.showcase-grouping--grip \.showcase-grouping-head\s*\{([^}]*)\}/,
    );
    const menu = styles.match(
      /\n\.showcase-grouping--menu \.showcase-grouping-head\s*\{([^}]*)\}/,
    );
    expect(head).not.toBeNull();
    expect(grip).not.toBeNull();
    expect(menu).not.toBeNull();
    expect(head[1]).toMatch(/height:\s*34px/);
    expect(head[1]).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/);
    expect(grip[1]).toMatch(/padding-left:\s*40px/);
    expect(menu[1]).toMatch(/padding-right:\s*32px/);
  });

  test("the reorder cell is a window: a bar, then the photo, one frame", () => {
    const cell = styles.match(/\n\.showcase-reorder-cell\s*\{([^}]*)\}/);
    const bar = styles.match(/\n\.showcase-reorder-bar\s*\{([^}]*)\}/);
    const title = styles.match(/\n\.showcase-reorder-title\s*\{([^}]*)\}/);
    expect(cell).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(title).not.toBeNull();
    expect(cell[1]).toMatch(/padding:\s*0 0 6px/);
    expect(cell[1]).not.toMatch(/padding-top/);
    expect(bar[1]).toMatch(/height:\s*34px/);
    expect(bar[1]).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/);
    expect(title[1]).toMatch(/text-overflow:\s*ellipsis/);
  });

  test("the card fills its reorder cell so cell and content end together", () => {
    const fill = styles.match(
      /\.showcase-reorder-cell > \.showcase-card,[\s\S]*?\.showcase-reorder-cell > \.showcase-cell > \.showcase-card\s*\{([^}]*)\}/,
    );
    expect(fill).not.toBeNull();
    expect(fill[1]).toMatch(/flex:\s*1/);
    // One frame per item: the cell owns the border, the card inside never
    // paints a second one.
    expect(fill[1]).toMatch(/border-color:\s*transparent/);
    expect(fill[1]).toMatch(/background:\s*transparent/);
  });

  test("the level's add action closes the grid as one slim row", () => {
    // A card-sized empty tile read as a missing specimen; the add action is a
    // one-line bar spanning the whole row instead.
    const bar = styles.match(
      /\n\.showcase-grid > \.showcase-ghost-add--bar\s*\{([^}]*)\}/,
    );
    expect(bar).not.toBeNull();
    expect(bar[1]).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(styles).not.toMatch(/\n\.showcase-add-card\s*\{/);
  });

  test("the grouping cover sits on the catalog photo plate", () => {
    const well = styles.match(/\n\.showcase-grouping-well\s*\{([^}]*)\}/);
    expect(well).not.toBeNull();
    expect(well[1]).toMatch(/width:\s*calc\(100% - 20px\)/);
    expect(well[1]).toMatch(/aspect-ratio:\s*2 \/ 1/);
    expect(well[1]).toMatch(/margin:\s*10px 10px 0/);
    expect(well[1]).toMatch(/border:\s*1px solid var\(--border-soft\)/);
    expect(well[1]).toMatch(/background:\s*var\(--surface-2\)/);
  });

  test("the contents and action rows mirror catalog metadata and ownership", () => {
    const meta = styles.match(/\n\.showcase-grouping-meta\s*\{([^}]*)\}/);
    const action = styles.match(/\n\.showcase-grouping-action\s*\{([^}]*)\}/);
    expect(meta).not.toBeNull();
    expect(action).not.toBeNull();
    expect(meta[1]).toMatch(/min-height:\s*34px/);
    expect(meta[1]).toMatch(/padding:\s*2px 11px 6px/);
    expect(action[1]).toMatch(/min-height:\s*28px/);
    expect(action[1]).toMatch(/border-top:\s*1px solid var\(--border-soft\)/);
    expect(action[1]).toMatch(/text-transform:\s*uppercase/);
    expect(action[1]).toMatch(/color:\s*var\(--text-muted\)/);
    expect(styles).toMatch(
      /\.showcase-card--grouping:hover \.showcase-grouping-action,[\s\S]*?color:\s*var\(--accent-strong\)/,
    );
  });

  test("the auction rail uses the rail-label split", () => {
    const rail = styles.match(/\n\.showcase-card--grouping-rail\s*\{([^}]*)\}/);
    const body = styles.match(
      /\n\.showcase-grouping-rail-body\s*\{([^}]*)\}/,
    );
    const count = styles.match(
      /\n\.showcase-grouping-rail-count\s*\{([^}]*)\}/,
    );
    const handle = styles.match(
      /\n\.showcase-grouping--rail > \.showcase-reorder-handle\s*\{([^}]*)\}/,
    );
    expect(rail).not.toBeNull();
    expect(body).not.toBeNull();
    expect(count).not.toBeNull();
    expect(handle).not.toBeNull();
    expect(rail[1]).toMatch(/min-height:\s*176px/);
    expect(body[1]).toMatch(/flex:\s*0 0 var\(--grouping-rail-width\)/);
    expect(count[1]).toMatch(/font-size:\s*1\.45rem/);
    expect(handle[1]).toMatch(/right:\s*calc\(/);
  });

  // The identity column is a share of the card, not a fixed strip: a wide
  // card's photo gives the extra width to the text instead of keeping it.
  test("the rail's identity column grows with a wide card", () => {
    const grid = styles.match(/\n\.showcase-grid\s*\{([^}]*)\}/);
    expect(grid).not.toBeNull();
    expect(grid[1]).toMatch(
      /--showcase-rail-width:\s*clamp\(132px,\s*30%,\s*240px\)/,
    );

    // Every rail card reads the one value, so groupings and catalog cards keep
    // a single identity line in a row.
    const catalog = styles.match(/\n\.showcase-catalog-rail\s*\{([^}]*)\}/);
    const grouping = styles.match(
      /\n\.showcase-grouping--rail\s*\{([^}]*)\}/,
    );
    expect(catalog).not.toBeNull();
    expect(grouping).not.toBeNull();
    expect(catalog[1]).toMatch(
      /flex:\s*0 0 var\(--showcase-rail-width(?:,\s*132px)?\)/,
    );
    expect(grouping[1]).toMatch(
      /--grouping-rail-width:\s*var\(--showcase-rail-width(?:,\s*132px)?\)/,
    );
  });

  // The rail stack has the vertical room the folio's fixed row lacks, so the
  // contents list breaks across lines instead of ending in an ellipsis.
  test("the rail contents list wraps instead of truncating", () => {
    const summary = styles.match(
      /\.showcase-grouping--rail \.showcase-grouping-summary\s*\{([^}]*)\}/,
    );
    expect(summary).not.toBeNull();
    expect(summary[1]).toMatch(/white-space:\s*normal/);
    expect(summary[1]).toMatch(/overflow:\s*visible/);
    expect(summary[1]).toMatch(/text-overflow:\s*clip/);
  });
});

describe("showcase note-card flip control", () => {
  test("the flip control pins to the image's bottom-right corner", () => {
    const flip = styles.match(/\n\.showcase-card-flip\s*\{([^}]*)\}/);
    expect(flip).not.toBeNull();
    expect(flip[1]).toMatch(/position:\s*absolute/);
    expect(flip[1]).toMatch(/right:\s*8px/);
    expect(flip[1]).toMatch(/bottom:\s*8px/);
  });
});

describe("showcase focus: proof frame", () => {
  test("keyboard focus rules the item instead of drawing a frame ring", () => {
    expect(styles).not.toMatch(
      /\.showcase-reorder-cell:has\(:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/,
    );
    expect(styles).not.toMatch(/\.showcase-cell-marks/);

    const top = styles.match(/\n\.showcase-reorder-cell::before\s*\{([^}]*)\}/);
    const bottom = styles.match(/\n\.showcase-reorder-cell::after\s*\{([^}]*)\}/);
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(top[1]).toMatch(/border-top:\s*2px solid var\(--accent\)/);
    expect(bottom[1]).toMatch(/border-bottom:\s*2px solid var\(--accent\)/);
  });

  test("the top rule follows the cell's rounded corners", () => {
    const rule = styles.match(/\n\.showcase-reorder-cell::before\s*\{([^}]*)\}/);
    const hover = styles.match(
      /\.showcase-reorder-cell:hover::before\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(hover).not.toBeNull();
    expect(rule[1]).toMatch(
      /border-radius:\s*var\(--radius-md\) var\(--radius-md\) 0 0/,
    );
    expect(rule[1]).toMatch(/clip-path:\s*inset\(0 100% 0 0\)/);
    expect(hover[1]).toMatch(/clip-path:\s*inset\(0 0 0 0\)/);
  });

  test("the bottom rule mirrors the corner radius and sweeps the other way", () => {
    const bottom = styles.match(/\n\.showcase-reorder-cell::after\s*\{([^}]*)\}/);
    expect(bottom).not.toBeNull();
    expect(bottom[1]).toMatch(/bottom:\s*0/);
    expect(bottom[1]).toMatch(
      /border-radius:\s*0 0 var\(--radius-md\) var\(--radius-md\)/,
    );
    expect(bottom[1]).toMatch(/clip-path:\s*inset\(0 0 0 100%\)/);
  });

  test("card focus holds the top rule and completes the bottom rule", () => {
    const frame = styles.match(
      /\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\)::before,\s*\n?\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\)::after\s*\{([^}]*)\}/,
    );
    expect(frame).not.toBeNull();
    expect(frame[1]).toMatch(/clip-path:\s*inset\(0 0 0 0\)/);
  });

  test("the frame belongs to the card body, not the cell's other controls", () => {
    expect(styles).not.toMatch(/\.showcase-reorder-cell:has\(:focus-visible\)::/);
  });

  test("the catalog code turns accent while the card holds focus", () => {
    const code = styles.match(
      /\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\)\s+\.showcase-catalog-code\s*\{([^}]*)\}/,
    );
    expect(code).not.toBeNull();
    expect(code[1]).toMatch(/color:\s*var\(--accent-strong\)/);
  });

  test("the inner card never paints a second ring or wash", () => {
    const rule = styles.match(
      /\.showcase-reorder-cell \.showcase-card:focus-visible\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/background:\s*transparent/);
    expect(rule[1]).toMatch(/box-shadow:\s*none/);
  });

  test("the grouping keeps the cell's single frame, never a spine", () => {
    expect(styles).not.toMatch(
      /\.showcase-card--grouping\s*\{[^}]*box-shadow:\s*inset 3px 0 0/,
    );
    expect(styles).not.toMatch(
      /\.showcase-reorder-cell \.showcase-card--grouping:focus-visible/,
    );
  });

  test("the ownership footer marks its row instead of tracing a second edge", () => {
    const rule = styles.match(
      /\n\.showcase-card-state--footer:focus-visible\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/box-shadow:\s*inset 0 2px 0 var\(--accent\)/);
    expect(rule[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(rule[1]).toMatch(/outline:\s*none/);
    // No semantic fill: focus is a red marker, never a button ground.
    expect(rule[1]).not.toMatch(/background:\s*var\(--(success|accent-strong)\)/);
  });

  test("the owned footer keeps its state colour while focused", () => {
    const rule = styles.match(
      /\n\.showcase-card-state--owned\.showcase-card-state--footer:focus-visible\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/color:\s*var\(--success\)/);
    expect(rule[1]).toMatch(/box-shadow:\s*inset 0 2px 0 var\(--accent\)/);
    expect(rule[1]).not.toMatch(/background:\s*var\(--success\)/);
  });
});

describe("showcase note-card motion", () => {
  test("the front and back faces cross-fade", () => {
    const face = styles.match(/\n\.showcase-card-face\s*\{([^}]*)\}/);
    expect(face).not.toBeNull();
    expect(face[1]).toMatch(/transition:\s*opacity/);
  });

  test("reduced motion stops the swap cross-fade", () => {
    const block = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(
      /\.showcase-card-face\s*\{[^}]*transition:\s*none/,
    );
  });

  test("reduced motion lands the proof frame without the sweep", () => {
    const block = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.showcase-reorder-cell::before/);
    expect(block[1]).toMatch(/\.showcase-reorder-cell::after/);
    expect(block[1]).toMatch(/transition:\s*none/);
  });
});

describe("showcase drill breadcrumb", () => {
  test("the trail keeps a gap from the filter bar's rule", () => {
    const breadcrumb = styles.match(/\n\.showcase-breadcrumb\s*\{([^}]*)\}/);
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb[1]).toMatch(/margin:\s*12px\s+0\s+16px/);
  });
});
