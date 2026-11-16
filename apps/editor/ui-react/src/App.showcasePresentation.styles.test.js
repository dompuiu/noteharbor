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
  test("grouping shares the note card's padding and alignment", () => {
    const note = styles.match(/\n\.showcase-card--note\s*\{([^}]*)\}/);
    const grouping = styles.match(/\n\.showcase-card--grouping\s*\{([^}]*)\}/);
    expect(note).not.toBeNull();
    expect(grouping).not.toBeNull();
    for (const prop of [
      /justify-content:\s*flex-start/,
      /gap:\s*8px/,
      // The bottom pad stays tight so no daylight sits under the caption.
      /padding:\s*10px 10px 6px/,
    ]) {
      expect(note[1]).toMatch(prop);
      expect(grouping[1]).toMatch(prop);
    }
  });

  test("the reorder cell is a window: a bar, then the photo, one frame", () => {
    const cell = styles.match(/\n\.showcase-reorder-cell\s*\{([^}]*)\}/);
    const bar = styles.match(/\n\.showcase-reorder-bar\s*\{([^}]*)\}/);
    const title = styles.match(/\n\.showcase-reorder-title\s*\{([^}]*)\}/);
    const editcard = styles.match(
      /\n\.showcase-grouping-editcard\s*\{([^}]*)\}/,
    );
    expect(cell).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(title).not.toBeNull();
    expect(editcard).not.toBeNull();
    expect(cell[1]).toMatch(/padding:\s*0 0 6px/);
    expect(cell[1]).not.toMatch(/padding-top/);
    expect(bar[1]).toMatch(/height:\s*34px/);
    expect(bar[1]).toMatch(/border-bottom:\s*1px solid var\(--border-soft\)/);
    expect(title[1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(editcard[1]).toMatch(/padding:\s*10px 10px 6px/);
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

  test("grouping footer shares the caption's line metrics", () => {
    const caption = styles.match(/\n\.showcase-card-caption\s*\{([^}]*)\}/);
    const name = styles.match(
      /\n\.showcase-card--grouping \.showcase-card-name\s*\{([^}]*)\}/,
    );
    expect(caption).not.toBeNull();
    expect(name).not.toBeNull();
    for (const prop of [
      /font-size:\s*0\.85rem/,
      /line-height:\s*1\.4/,
      /min-height:\s*1\.4em/,
    ]) {
      expect(caption[1]).toMatch(prop);
      expect(name[1]).toMatch(prop);
    }
  });

  test("grouping stays distinguishable without changing size", () => {
    const grouping = styles.match(/\n\.showcase-card--grouping\s*\{([^}]*)\}/);
    const name = styles.match(
      /\n\.showcase-card--grouping \.showcase-card-name\s*\{([^}]*)\}/,
    );
    const icon = styles.match(/\n\.showcase-card-name-icon\s*\{([^}]*)\}/);
    const image = styles.match(/\n\.showcase-card-image\s*\{([^}]*)\}/);
    expect(grouping).not.toBeNull();
    expect(grouping[1]).toMatch(/background:\s*var\(--surface\)/);
    expect(grouping[1]).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--accent\)/);
    expect(name).not.toBeNull();
    expect(name[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(icon).not.toBeNull();
    expect(icon[1]).toMatch(/width:\s*1em/);
    expect(icon[1]).toMatch(/height:\s*1em/);
    // The image well is transparent so letterboxed photos blend into the
    // card instead of adding a third background tone.
    expect(image).not.toBeNull();
    expect(image[1]).toMatch(/background:\s*transparent/);
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

describe("showcase focus: register marks", () => {
  test("keyboard focus draws four corner marks instead of a frame ring", () => {
    expect(styles).not.toMatch(
      /\.showcase-reorder-cell:has\(:focus-visible\)\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--accent\)/,
    );

    const marks = styles.match(
      /\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\) \.showcase-cell-mark\s*\{([^}]*)\}/,
    );
    expect(marks).not.toBeNull();
    expect(marks[1]).toMatch(/opacity:\s*1/);
  });

  test("the marks belong to the card body, not the cell's other controls", () => {
    expect(styles).not.toMatch(
      /\.showcase-reorder-cell:has\(:focus-visible\) \.showcase-cell-mark/,
    );
  });

  test("the marks overlay stays decoration for pointer and assistive tech", () => {
    const overlay = styles.match(/\n\.showcase-cell-marks\s*\{([^}]*)\}/);
    expect(overlay).not.toBeNull();
    expect(overlay[1]).toMatch(/position:\s*absolute/);
    expect(overlay[1]).toMatch(/pointer-events:\s*none/);
  });

  test("each mark is an 18px pair of accent rules that scale in", () => {
    const mark = styles.match(/\n\.showcase-cell-mark\s*\{([^}]*)\}/);
    const arms = styles.match(
      /\n\.showcase-cell-mark::before,\s*\n?\.showcase-cell-mark::after\s*\{([^}]*)\}/,
    );
    expect(mark).not.toBeNull();
    expect(arms).not.toBeNull();
    expect(mark[1]).toMatch(/width:\s*18px/);
    expect(mark[1]).toMatch(/height:\s*18px/);
    expect(mark[1]).toMatch(/opacity:\s*0/);
    expect(arms[1]).toMatch(/background:\s*var\(--accent\)/);
    expect(arms[1]).toMatch(/transform:\s*scale\(0\)/);
  });

  test("the marks draw 30ms apart, corner by corner", () => {
    const stagger = (corner) =>
      styles.match(
        new RegExp(
          `\\.showcase-reorder-cell:has\\(\\.showcase-card:focus-visible\\)\\s+\\.showcase-cell-mark:nth-child\\(${corner}\\)::before,[\\s\\S]*?` +
            `nth-child\\(${corner}\\)::after\\s*\\{([^}]*)\\}`,
        ),
      );

    for (const [corner, delay] of [
      [2, "30ms"],
      [3, "60ms"],
      [4, "90ms"],
    ]) {
      const block = stagger(corner);
      expect(block).not.toBeNull();
      expect(block[1]).toContain(`transition-delay: ${delay}`);
    }
  });

  test("the hover rule follows the cell's rounded corners", () => {
    const rule = styles.match(/\n\.showcase-reorder-cell::before\s*\{([^}]*)\}/);
    const hover = styles.match(
      /\.showcase-reorder-cell:hover::before\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(hover).not.toBeNull();
    expect(rule[1]).toMatch(/border-top:\s*2px solid var\(--accent\)/);
    expect(rule[1]).toMatch(
      /border-radius:\s*var\(--radius-md\) var\(--radius-md\) 0 0/,
    );
    expect(rule[1]).toMatch(/clip-path:\s*inset\(0 100% 0 0\)/);
    expect(hover[1]).toMatch(/clip-path:\s*inset\(0 0 0 0\)/);
  });

  test("focus yields the line to the marks", () => {
    const rule = styles.match(
      /\.showcase-reorder-cell:has\(\.showcase-card:focus-visible\)::before\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/clip-path:\s*inset\(0 100% 0 0\)/);
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

  test("the grouping keeps only its spine once its card is focused", () => {
    expect(styles).toMatch(
      /\.showcase-reorder-cell \.showcase-card--grouping:focus-visible\s*\{[^}]*box-shadow:\s*inset 3px 0 0 var\(--accent\)/,
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

  test("reduced motion lands the focus marks without the sweep or stagger", () => {
    const block = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/\.showcase-reorder-cell::before/);
    expect(block[1]).toMatch(/\.showcase-cell-mark::before/);
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
