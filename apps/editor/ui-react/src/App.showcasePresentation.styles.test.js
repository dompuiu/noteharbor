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

  test("the ghost card keeps a 120px floor while the grid stretches it", () => {
    // The grid stretches the card to the row like a note; the floor only
    // keeps an otherwise empty level from collapsing. No calc here, so it
    // can never push the row taller than the notes.
    const card = styles.match(/\n\.showcase-add-card\s*\{([^}]*)\}/);
    expect(card).not.toBeNull();
    expect(card[1]).toMatch(/height:\s*100%/);
    expect(card[1]).toMatch(/min-height:\s*120px/);
    expect(card[1]).not.toMatch(/calc/);
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
});

describe("showcase note-card info tooltip", () => {
  test("the info icon stays inline at 1em like the grouping footer icon", () => {
    const icon = styles.match(/\n\.showcase-card-info-icon\s*\{([^}]*)\}/);
    expect(icon).not.toBeNull();
    expect(icon[1]).toMatch(/width:\s*1em/);
    expect(icon[1]).toMatch(/height:\s*1em/);
  });

  test("the tooltip opens below the caption row, by the info icon", () => {
    const row = styles.match(/\n\.showcase-card-caption-row\s*\{([^}]*)\}/);
    const tooltip = styles.match(/\n\.showcase-card-tooltip\s*\{([^}]*)\}/);
    expect(row).not.toBeNull();
    expect(tooltip).not.toBeNull();
    expect(row[1]).toMatch(/position:\s*relative/);
    expect(tooltip[1]).toMatch(/position:\s*absolute/);
    expect(tooltip[1]).toMatch(/top:\s*calc\(100%/);
    expect(tooltip[1]).toMatch(/right:\s*0/);
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
      /\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\) \.showcase-catalog-code\s*\{([^}]*)\}/,
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
