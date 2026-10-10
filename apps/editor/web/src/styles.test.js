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
  });

  test("expands on hover and on keyboard focus entering the rail", () => {
    expect(styles).toMatch(/\.sidebar-dock:hover\s+\.sidebar/);
    expect(styles).toMatch(/\.sidebar-dock:has\(:focus-visible\)\s+\.sidebar/);
  });

  test("hangs the links off an indented rule under each group label", () => {
    const links = styles.match(/\.sidebar-group-links\s*\{([^}]*)\}/);
    expect(links).not.toBeNull();
    expect(links[1]).toMatch(/margin-left:/);
    expect(links[1]).toMatch(/padding-left:/);
    expect(links[1]).toMatch(/border-left:\s*1\.5px\s+solid/);
  });

  test("separates the groups with a rule", () => {
    expect(styles).toMatch(
      /\.sidebar-group\s*\+\s*\.sidebar-group\s*\{[^}]*border-top:/,
    );
  });

  test("hides the link labels and names on the collapsed rail", () => {
    expect(styles).toMatch(
      /\.sidebar-dock \.sidebar-link-label,\s*\n?\s*\.sidebar-dock \.sidebar-group-name\s*\{[^}]*display:\s*none/,
    );
    expect(styles).toMatch(
      /\.sidebar-dock \.sidebar-group-links\s*\{[^}]*border-left:\s*0/,
    );
  });

  // The collapsed rail keeps each category's marker while the name drops away,
  // so the sections stay readable as categories rather than anonymous glyphs.
  test("keeps the category marker visible and accent-tinted when collapsed", () => {
    const marker = styles.match(/\.sidebar-group-ic\s*\{([^}]*)\}/);
    expect(marker).not.toBeNull();
    expect(marker[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(marker[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(marker[1]).toMatch(/border-radius:\s*50%/);
    // The name, not the marker, is what hides.
    expect(styles).not.toMatch(
      /\.sidebar-dock \.sidebar-group-label\s*\{[^}]*display:\s*none/,
    );
    expect(styles).toMatch(
      /\.sidebar-dock:not\(\.sidebar-dock--open\):not\(:hover\):not\(:has\(:focus-visible\)\) \.sidebar-group-label\s*\{[^}]*justify-content:\s*center/,
    );
  });

  // Opening the rail must not shift the marker. The label's padding is fixed
  // across states, and only the name toggles, so hover never moves the icon.
  test("the category marker does not jump when the rail expands", () => {
    const label = styles.match(/\.sidebar-group-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/padding:\s*10px 9px 6px/);
    // Collapsed keeps that box and only centres within it via justify-content;
    // no rule overrides the label's padding on hover/collapse.
    expect(styles).not.toMatch(
      /\.sidebar-dock:hover \.sidebar-group-label\s*\{[^}]*padding/,
    );
  });

  test("the reorder toggles and move buttons hide on the collapsed rail", () => {
    expect(styles).toMatch(
      /\.sidebar-dock \.sidebar-reorder-toggle,\s*\n?\s*\.sidebar-dock \.sidebar-row-moves\s*\{[^}]*display:\s*none/,
    );
    expect(styles).toMatch(
      /\.sidebar-dock:hover \.sidebar-reorder-toggle/,
    );
  });

  test("reorderable rows mark the drop edge like the links do", () => {
    expect(styles).toMatch(
      /\.sidebar-row--drop-before\s*\{[^}]*box-shadow:\s*inset 0 2px 0 0 var\(--accent\)/,
    );
    expect(styles).toMatch(
      /\.sidebar-row--drop-after\s*\{[^}]*box-shadow:\s*inset 0 -2px 0 0 var\(--accent\)/,
    );
  });

  test("names beyond the widened rail still truncate with an ellipsis", () => {
    // The rail widens for long names up to its cap; only names beyond
    // the cap ellipsise inside the row. Every level of the flex chain
    // into the label must be allowed to shrink — a flex item keeps
    // `min-width: auto` (content-sized, no shrinking) unless overridden.
    const label = styles.match(/\.sidebar-link-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/min-width:\s*0/);
    expect(label[1]).toMatch(/overflow:\s*hidden/);
    expect(label[1]).toMatch(/text-overflow:\s*ellipsis/);
    // The flex chain into the label must be allowed to shrink.
    const row = styles.match(/\.sidebar-row\s*\{([^}]*)\}/);
    expect(row).not.toBeNull();
    expect(row[1]).toMatch(/min-width:\s*0/);
  });

  test("long names widen the rail instead of truncating at 288px", () => {
    // The expanded rail fits its content: short names get the 288px floor
    // while longer names widen it, up to a cap past which the ellipsis
    // still applies.
    const expanded = styles.match(
      /\.sidebar-dock:hover \.sidebar,\s*\n?\s*\.sidebar-dock:has\(:focus-visible\) \.sidebar\s*\{([^}]*)\}/,
    );
    expect(expanded).not.toBeNull();
    expect(expanded[1]).toMatch(
      /width:\s*max\(var\(--sidebar-expanded-width\),\s*max-content\)/,
    );
    expect(expanded[1]).toMatch(/max-width:\s*480px/);
  });

  test("reorderable rows grab the cursor for dragging", () => {
    const row = styles.match(/\.sidebar-row\s*\{([^}]*)\}/);
    expect(row).not.toBeNull();
    expect(row[1]).toMatch(/cursor:\s*grab/);
  });

  test("row and header wrappers span the links block like the links do", () => {
    // The links block keeps the collapsed rail's `align-items: center`.
    // Plain links are immune via their own `width: 100%`; the row and
    // header wrappers need the same, or they shrink-wrap and centre
    // themselves instead of lining up with the links.
    const row = styles.match(/\.sidebar-row\s*\{([^}]*)\}/);
    expect(row).not.toBeNull();
    expect(row[1]).toMatch(/width:\s*100%/);
    const head = styles.match(/\.sidebar-group-head\s*\{([^}]*)\}/);
    expect(head).not.toBeNull();
    expect(head[1]).toMatch(/width:\s*100%/);
  });

  test("the rail width transition can interpolate to max-content", () => {
    // The expanded rail fits its content (max(288px, max-content)), which
    // only animates when keyword interpolation is allowed. Without this,
    // the 64px -> max-content width change snaps instead of transitioning.
    const sidebar = styles.match(/\.sidebar\s*\{([^}]*)\}/);
    expect(sidebar).not.toBeNull();
    expect(sidebar[1]).toMatch(/interpolate-size:\s*allow-keywords/);
  });

  test("the expanding labels fade and slide in", () => {
    // Width alone may snap where keyword interpolation is unsupported, so
    // the labels carry their own entrance motion on expand.
    expect(styles).toMatch(/@keyframes\s+sidebar-label-in/);
    const expandedLabels = styles.match(
      /\.sidebar-dock:hover \.sidebar-link-label,[\s\S]*?\{([^}]*)\}/,
    );
    expect(expandedLabels).not.toBeNull();
    expect(expandedLabels[1]).toMatch(/animation:\s*sidebar-label-in/);
  });

  test("the keyboard-open class expands the rail like hover and focus", () => {
    // Keyboard navigation holds the rail open through a React-owned class,
    // not through `:has(:focus-visible)` alone: the class cannot flicker
    // between key presses, so the labels keep one steady computed style.
    const open = styles.match(
      /\.sidebar-dock\.sidebar-dock--open \.sidebar\s*\{([^}]*)\}/,
    );
    expect(open).not.toBeNull();
    expect(open[1]).toMatch(
      /width:\s*max\(var\(--sidebar-expanded-width\),\s*max-content\)/,
    );
    expect(open[1]).toMatch(/max-width:\s*480px/);
  });

  test("the keyboard-open class shows the labels with the entrance", () => {
    const labels = styles.match(
      /\.sidebar-dock\.sidebar-dock--open \.sidebar-link-label,[\s\S]*?\{([^}]*)\}/,
    );
    expect(labels).not.toBeNull();
    expect(labels[1]).toMatch(/display:\s*block/);
    expect(labels[1]).toMatch(/animation:\s*sidebar-label-in/);
  });

  test("the collapsed-rail rules yield to the keyboard-open class", () => {
    // The centred collapsed-rail rules must not match while keyboard-open,
    // or they would fight the open layout whenever focus visibility
    // flickers between key presses.
    expect(styles).toMatch(
      /\.sidebar-dock:not\(\.sidebar-dock--open\):not\(:hover\):not\(:has\(:focus-visible\)\) \.sidebar-link--cursor/,
    );
  });

  test("the cursor link is ringed so focus is visible", () => {
    expect(styles).toMatch(
      /\.sidebar-link--cursor\s*\{[^}]*box-shadow:\s*inset 0 0 0 1\.5px var\(--accent\)/,
    );
  });

  test("the cursor ring replaces the default focus outline", () => {
    // The cursor link already draws its own ring, so the global
    // :focus-visible outline would double it. The outline is dropped only on
    // the cursor link; a plain Tab focus keeps the browser outline.
    expect(styles).toMatch(
      /\.sidebar-link--cursor:focus-visible\s*\{[^}]*outline:\s*none/,
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

  // The Editor holds a fixed 1200px desktop layout at every viewport width:
  // narrow windows scroll horizontally instead of reflowing, so there are no
  // width-based media queries and no narrow-screen drawer to conflict with
  // the "b" rail shortcut.
  test("has no width-based media queries", () => {
    expect(styles).not.toMatch(/@media\s*\((max|min)-width/);
  });

  test("has no drawer, hamburger, or backdrop selectors", () => {
    expect(styles).not.toMatch(/drawer-open/);
    expect(styles).not.toMatch(/\.sidebar-hamburger/);
    expect(styles).not.toMatch(/\.sidebar-backdrop/);
  });
});

describe("app minimum width", () => {
  // The Editor targets desktop estates: below 1200px the layout breaks, so
  // the app holds a 1200px floor and scrolls horizontally instead of
  // squeezing.
  test("the body holds the 1200px floor", () => {
    const body = styles.match(/body\s*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body[1]).toMatch(/min-width:\s*1200px/);
  });

  test("the body scrolls horizontally instead of clipping", () => {
    const body = styles.match(/body\s*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body[1]).toMatch(/overflow-x:\s*auto/);
    expect(body[1]).not.toMatch(/overflow:\s*hidden/);
  });

  test("the app shell holds the 1200px floor", () => {
    const shell = styles.match(/\.app-shell\s*\{([^}]*)\}/);
    expect(shell).not.toBeNull();
    expect(shell[1]).toMatch(/min-width:\s*1200px/);
  });
});

describe("slideshow overlay styles", () => {
  // The slideshow floats over the app like the image preview: a full-viewport
  // scrim with the slideshow panel on top, so the sidebar stays visible and
  // hoverable behind it instead of being covered by an opaque panel.
  test("scrims the viewport with the image-preview tint", () => {
    const overlay = styles.match(/\.slideshow-screen--overlay\s*\{([^}]*)\}/);
    expect(overlay).not.toBeNull();
    expect(overlay[1]).toMatch(/position:\s*fixed/);
    expect(overlay[1]).toMatch(/inset:\s*0/);
    expect(overlay[1]).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.88\)/);
    // The scrim carries the on-dark text colour so the image preview, which is
    // a sibling of the panel, still inherits readable light text.
    expect(overlay[1]).toMatch(/color:\s*var\(--on-dark-text\)/);
  });

  // The panel fills the scrim so the slideshow keeps the estate the old
  // near-full-viewport panel had.
  test("the slideshow panel fills the scrim", () => {
    const panel = styles.match(
      /\.slideshow-screen--overlay \.slideshow-panel\s*\{([^}]*)\}/,
    );
    expect(panel).not.toBeNull();
    expect(panel[1]).toMatch(/background:\s*var\(--on-dark-bg\)/);
    expect(panel[1]).toMatch(/min-height:\s*calc\(100vh/);
  });

  // Fixed overlays size against the viewport, so the body's 1200px floor
  // never reaches them. Each overlay freezes its content at its 1200px
  // rendering and scrolls instead of reflowing on smaller windows.
  test("the slideshow panel holds the 1200px floor", () => {
    const panel = styles.match(
      /\.slideshow-screen--overlay \.slideshow-panel\s*\{([^}]*)\}/,
    );
    expect(panel).not.toBeNull();
    // 1200px minus the overlay's 16px side padding.
    expect(panel[1]).toMatch(/min-width:\s*calc\(1200px - 32px\)/);
  });

  test("the edit-note overlay scrolls horizontally instead of squeezing", () => {
    const overlay = styles.match(/\.edit-note-overlay\s*\{([^}]*)\}/);
    expect(overlay).not.toBeNull();
    expect(overlay[1]).toMatch(/overflow:\s*auto/);
    expect(overlay[1]).not.toMatch(/overflow-y/);
  });

  test("the edit-note frame holds the 1200px floor with the form centred", () => {
    const frame = styles.match(/\.edit-note-overlay-frame\s*\{([^}]*)\}/);
    expect(frame).not.toBeNull();
    // 1200px minus the overlay's 24px side padding; the 900px form stays
    // centred in that canvas via the frame's flex centering.
    expect(frame[1]).toMatch(/min-width:\s*calc\(1200px - 48px\)/);
    expect(frame[1]).toMatch(/justify-content:\s*center/);
    // Auto inline margins keep the frame centred with a reachable start when
    // it overflows, unlike the overlay's plain center placement.
    expect(frame[1]).toMatch(/margin-inline:\s*auto/);
  });

  test("the edit-note content stays 900px centred in the floor", () => {
    const content = styles.match(
      /\.edit-note-overlay-content\s*\{([^}]*)\}/,
    );
    expect(content).not.toBeNull();
    expect(content[1]).toMatch(/width:\s*min\(100%,\s*900px\)/);
  });

  test("the scrape-conflict frame holds the 1200px floor", () => {
    const frame = styles.match(
      /\.scrape-conflict-overlay-frame\s*\{([^}]*)\}/,
    );
    expect(frame).not.toBeNull();
    expect(frame[1]).toMatch(/min-width:\s*calc\(1200px - 48px\)/);
  });

  test("the image popover scrolls instead of squeezing", () => {
    const overlay = styles.match(/\.image-popover-overlay\s*\{([^}]*)\}/);
    expect(overlay).not.toBeNull();
    expect(overlay[1]).toMatch(/overflow:\s*auto/);
  });

  test("the image popover content holds its 1200px-viewport width", () => {
    const content = styles.match(/\.image-popover-content\s*\{([^}]*)\}/);
    expect(content).not.toBeNull();
    // Its width at a 1200px viewport: min(1400px, 96vw).
    expect(content[1]).toMatch(/min-width:\s*1152px/);
    expect(content[1]).toMatch(/margin:\s*auto/);
  });

  test("the showcase panel scrolls vertically instead of cropping", () => {
    const panel = styles.match(
      /\.screen-stack\.showcase-screen > \.panel\s*\{([^}]*)\}/,
    );
    expect(panel).not.toBeNull();
    expect(panel[1]).toMatch(/overflow-y:\s*auto/);
  });

  // The category header's focus wash must stay off while renaming: the rename
  // field carries its own focus style, and painting the whole header row would
  // read as one giant input box.
  test("the category header wash stays off while renaming", () => {
    expect(styles).toMatch(
      /\.showcase-cell--category:not\(:has\(\.showcase-node-rename-form\)\):has\(\s*:focus-visible\s*\)/,
    );
  });

  // A full-screen overlay owns scrolling while open: the body's bar would
  // only scroll the dimmed app behind it, stacking a second horizontal bar
  // under the overlay's own. The body lock leaves the overlay's bar as the
  // single one. `:has()` needs no ref-counting, so stacked overlays stay
  // locked until the last one closes.
  test("the body locks horizontal scrolling while an overlay is open", () => {
    const lock = styles.match(/body:has\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(lock).not.toBeNull();
    expect(lock[1]).toMatch(/\.edit-note-overlay/);
    expect(lock[1]).toMatch(/\.slideshow-screen--overlay/);
    expect(lock[1]).toMatch(/\.image-popover-overlay/);
    expect(lock[2]).toMatch(/overflow-x:\s*hidden/);
  });
});
