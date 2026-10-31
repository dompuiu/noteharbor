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

  // Hover and selection share one wash, so a selected row is never a shade
  // darker than a hovered one. The accent edge and the checkbox carry the
  // selection state.
  test("the selected row tint matches the hover tint", () => {
    expect(styles).toMatch(/--row-selected:\s*var\(--accent-soft\)/);
    expect(styles).toMatch(
      /--accent-soft:\s*rgba\(150,\s*98,\s*47,\s*0\.12\)/,
    );
  });

  // Selection is painted on the cells and outranks the zebra stripe and the
  // hover/focus/active wash.
  test("a selected row carries the accent tint", () => {
    expect(styles).toMatch(
      /\.table-row-link--selected > td\s*\{\s*background-color:\s*var\(--row-selected\)/,
    );
  });

  // Interaction states replace the stripe instead of stacking on it, so a
  // hovered or focused striped row matches a plain one and its pinned columns.
  // Selection is one of those states.
  test("hover, focus, the cursor and selection drop the zebra stripe", () => {
    const states = styles.match(
      /\.table-row-link--zebra:hover,\s*\n[\s\S]*?\{([^}]*)\}/,
    );
    expect(states).not.toBeNull();
    expect(states[0]).toMatch(/:focus-visible/);
    expect(states[0]).toMatch(/:has\(:focus-visible\)/);
    expect(states[0]).toMatch(/\.table-row-link--active/);
    expect(states[0]).toMatch(/\.table-row-link--selected/);
    expect(states[1]).toMatch(/background:\s*transparent/);
  });

  // A selected row must not lose its wash when the pointer or keyboard cursor
  // arrives: the selection tint stays, while the cursor adds its own ring.
  test("a selected row keeps its tint on hover, focus and the keyboard cursor", () => {
    const tint = styles.match(
      /\.table-row-link--selected:hover > td,[\s\S]*?\{([^}]*)\}/,
    );
    expect(tint).not.toBeNull();
    expect(tint[0]).toMatch(/:focus-visible/);
    expect(tint[0]).toMatch(/:has\(:focus-visible\)/);
    expect(tint[0]).toMatch(/\.table-row-link--active/);
    expect(tint[1]).toMatch(/background-color:\s*var\(--row-selected\)/);

    const pinned = styles.match(
      /\.table-row-link--selected:hover > \.table-sticky-cell,[\s\S]*?\{([^}]*)\}/,
    );
    expect(pinned).not.toBeNull();
    expect(pinned[0]).toMatch(/\.table-row-link--active/);
    expect(pinned[1]).toMatch(/background-color:\s*var\(--surface\)/);
    expect(pinned[1]).toMatch(/linear-gradient\(var\(--row-selected\)/);
  });

  // A hovered zebra row must not paint a different tint on the pinned block
  // than on the scrolling cells: the stripe is cleared on the row, so the
  // pinned cells only lay the accent wash over the opaque surface. A stripe
  // repeated here would make hovered striped rows darker than plain ones.
  test("hover, focus and the cursor paint one tint on every cell", () => {
    const pinned = styles.match(
      /\.table-row-link:hover > \.table-sticky-cell,[\s\S]*?\{([^}]*)\}/,
    );
    expect(pinned).not.toBeNull();
    expect(pinned[0]).toMatch(/:focus-visible/);
    expect(pinned[0]).toMatch(/:has\(:focus-visible\)/);
    expect(pinned[0]).toMatch(/\.table-row-link--active/);
    expect(pinned[1]).toMatch(/background-color:\s*var\(--surface\)/);
    expect(pinned[1]).toMatch(
      /linear-gradient\(var\(--accent-soft\),\s*var\(--accent-soft\)\)/,
    );
    expect(pinned[1]).not.toMatch(/--row-zebra/);

    // No state-specific pinned rule may reintroduce the stripe.
    expect(styles).not.toMatch(
      /\.table-row-link--zebra:hover > \.table-sticky-cell/,
    );
  });

  // The accent edge marks the row's outer left edge. It lives on the drag
  // cell, not the checkbox cell, and the drag cell pins so the edge stays put
  // while the columns pan. The handle paints an opaque surface over the whole
  // cell, so the edge is a pseudo-element stacked above it, outside the
  // interaction rules and never in the way of the drag target.
  test("the selected edge sits on the pinned drag cell above the handle", () => {
    const cell = styles.match(/td\.drag-cell\s*\{([^}]*)\}/);
    expect(cell).not.toBeNull();
    expect(cell[1]).toMatch(/position:\s*sticky/);

    const edge = styles.match(
      /\.table-row-link--selected > td\.drag-cell::after\s*\{([^}]*)\}/,
    );
    expect(edge).not.toBeNull();
    expect(edge[1]).toMatch(/content:\s*""/);
    expect(edge[1]).toMatch(/position:\s*absolute/);
    expect(edge[1]).toMatch(/left:\s*0/);
    expect(edge[1]).toMatch(/width:\s*3px/);
    expect(edge[1]).toMatch(/background:\s*var\(--accent\)/);
    expect(edge[1]).toMatch(/z-index:\s*1/);
    expect(edge[1]).toMatch(/pointer-events:\s*none/);
    expect(styles).not.toMatch(/\.table-sticky-lead/);
  });

  // The bulk bar is an overlay, not a layout band: it reserves no flex slot,
  // so showing it never pushes the scroller or leaves a gap below the table.
  // The shell is its containing block, so the pill stays inside the card.
  test("the bulk bar floats over the rows inside the table shell", () => {
    expect(styles).toMatch(/\.table-shell\s*\{[^}]*position:\s*relative/);
    expect(styles).toMatch(
      /\.table-shell\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/,
    );

    const bar = styles.match(/\.table-bulk-bar\s*\{([^}]*)\}/);
    expect(bar).not.toBeNull();
    expect(bar[1]).toMatch(/position:\s*absolute/);
    expect(bar[1]).toMatch(/bottom:/);
    expect(bar[1]).toMatch(/left:\s*50%/);
    expect(bar[1]).toMatch(/transform:\s*translateX\(-50%\)/);

    const separator = styles.match(
      /\.table-bulk-bar-separator\s*\{([^}]*)\}/,
    );
    expect(separator).not.toBeNull();
    expect(separator[1]).toMatch(/width:\s*1px/);

    const clear = styles.match(
      /\.table-bulk-bar \.table-bulk-bar-clear\s*\{([^}]*)\}/,
    );
    expect(clear).not.toBeNull();
    expect(clear[1]).toMatch(/width:\s*30px/);
    expect(clear[1]).toMatch(/padding:\s*0/);
  });

  test("the overlay scrollbar stays inside the rows viewport", () => {
    expect(styles).toMatch(
      /\.table-viewport\s*\{[^}]*position:\s*relative/,
    );
  });

  // The gutter must be one column size shared by the header and body rows:
  // a body row without a trailing gutter cell leaves its zebra/selected tint
  // short of the scrollbar. jsdom cannot paint this (the vertical scrollbar
  // only appears from measured heights, which jsdom reports as zero), so the
  // contract lives in the stylesheet instead of a rendered assertion.
  test("the scrollbar gutter keeps one cell size for header and body", () => {
    const gutter = styles.match(/\.table-gutter-cell\s*\{([^}]*)\}/);

    expect(gutter).not.toBeNull();
    expect(gutter[1]).toMatch(/width:\s*14px/);
    expect(gutter[1]).toMatch(/min-width:\s*14px/);
    expect(gutter[1]).toMatch(/max-width:\s*14px/);
    expect(gutter[1]).toMatch(/padding:\s*0/);
  });

  // The gutter removes the pale strip before the scrollbar, not the scrollbar
  // itself: the track stays opaque behind the thumb.
  test("the overlay scrollbar keeps an opaque track and thumb", () => {
    const track = styles.match(/\.table-vtrack\s*\{([^}]*)\}/);
    const thumb = styles.match(/\.table-vthumb\s*\{([^}]*)\}/);

    expect(track).not.toBeNull();
    expect(track[1]).toMatch(/background:\s*var\(--scroll-track\)/);
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/background:\s*var\(--scroll-thumb\)/);
  });

  // The footer is a band below the table card, not an overlay and not part of
  // the bordered shell: it keeps its own fixed-size slot, on one line.
  test("the footer hint sits outside the table shell", () => {
    const hint = styles.match(/\.table-footer-hint\s*\{([^}]*)\}/);
    expect(hint).not.toBeNull();
    expect(hint[1]).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(hint[1]).not.toMatch(/position:\s*absolute/);
    expect(hint[1]).not.toMatch(/border-top/);
    expect(hint[1]).toMatch(/white-space:\s*nowrap/);
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

  test("sort bubbles leave breathing room around the label", () => {
    expect(styles).toMatch(/\.sort-button\s*\{[^}]*padding:\s*2px 8px/);
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

  // Active filters stay legible without opening the row: the chip fill and
  // the count badge use the warm accent family, not a new palette.
  test("filter chips and the count badge stay in the accent family", () => {
    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--accent-strong\)/);

    const count = styles.match(/\.table-filter-count\s*\{([^}]*)\}/);
    expect(count).not.toBeNull();
    expect(count[1]).toMatch(/background:\s*var\(--accent-strong\)/);
    expect(count[1]).toMatch(/color:\s*var\(--accent-ink\)/);
  });

  // The column picker is portalled so the table's scroll containers cannot
  // clip it, exactly like the row actions menu.
  test("the column picker floats above the table in a portal", () => {
    const menu = styles.match(/\.table-columns-menu\s*\{([^}]*)\}/);
    expect(menu).not.toBeNull();
    expect(menu[1]).toMatch(/position:\s*fixed/);
    expect(menu[1]).toMatch(/z-index:\s*\d+/);
  });

  // The row action button is intentionally invisible until the pointer or
  // keyboard arrives. jsdom cannot resolve :hover, so the reveal is pinned
  // here as a static contract over the stylesheet.
  test("row actions stay hidden until the row is hovered or focused", () => {
    const base = styles.match(/\.row-menu-btn\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base[1]).toMatch(/opacity:\s*0/);
    expect(styles).toMatch(
      /\.table-row-link:hover \.row-menu-btn[^{]*\{[^}]*opacity:\s*1/,
    );
    expect(styles).toMatch(
      /\.table-row-link:focus-within \.row-menu-btn[^{]*\{[^}]*opacity:\s*1/,
    );
    expect(styles).toMatch(/\.row-menu-btn\.is-open\s*\{[^}]*opacity:\s*1/);
  });

  test("touch devices always show the row actions button", () => {
    const media = styles.match(/@media \(hover: none\)\s*\{([\s\S]*?)\n\}/);
    expect(media).not.toBeNull();
    expect(media[1]).toMatch(/\.row-menu-btn\s*\{[^}]*opacity:\s*1/);
  });

  // The pinning metadata only works if the declared widths are the rendered
  // widths: the left offsets are computed from the model, so the table must
  // not stretch a pinned column when the viewport has space to spare.
  test("the table uses fixed column widths so pinned offsets stay exact", () => {
    expect(styles).toMatch(/table-layout:\s*fixed/);
    expect(styles).toMatch(/table\s*\{[^}]*width:\s*100cqw/);
    // The renderer's minimum mirrors these two values; keep the CSS side
    // pinned so the JS constants in NotesTable cannot drift silently.
    expect(styles).toMatch(/table\s*\{[^}]*min-width:\s*1200px/);
    expect(styles).toMatch(
      /\.table-scroll-x\s*\{[^}]*container-type:\s*inline-size/,
    );
  });

  // Both axes scroll in one element so sticky resolves against the same
  // scrollport for the header (top) and the pinned columns (left). The inner
  // wrapper must stay a plain box: making it a scroll container would move the
  // pinned cells' scrollport away from .table-scroll-x and reintroduce the
  // per-frame JavaScript offset.
  test("one scroller owns both axes and the wrapper does not scroll", () => {
    expect(styles).toMatch(/\.table-scroll-x\s*\{[^}]*overflow:\s*auto/);

    const wrapper = styles.match(/\.table-scroll-content\s*\{([^}]*)\}/);
    expect(wrapper).not.toBeNull();
    expect(wrapper[1]).not.toMatch(/(?:^|[;\s])overflow(?:-[xy])?\s*:/);
  });

  // The renderer computes every column width and writes it to the <colgroup>.
  // A CSS width on a first-row cell would override that <col> and restart the
  // proportional stretch of the fixed identity columns.
  test("the tags column never fixes its own width", () => {
    const tags = styles.match(/\.tags-column\s*\{([^}]*)\}/);
    expect(tags).not.toBeNull();
    expect(tags[1]).not.toMatch(/(?:^|[^a-z-])(?:max-)?width:/i);
  });

  test("the compact control columns use a few pixels of horizontal padding", () => {
    const order = styles.match(/\.table-order-cell\s*\{([^}]*)\}/);
    expect(order).not.toBeNull();
    expect(order[1]).toMatch(/padding-left:\s*4px/);
    expect(order[1]).toMatch(/padding-right:\s*4px/);

    const thumb = styles.match(/\.table-thumb-cell\s*\{([^}]*)\}/);
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/padding-left:\s*4px/);
    expect(thumb[1]).toMatch(/padding-right:\s*4px/);

    const actions = styles.match(/\.table-actions-cell\s*\{([^}]*)\}/);
    expect(actions).not.toBeNull();
    expect(actions[1]).toMatch(/padding-left:\s*4px/);
    expect(actions[1]).toMatch(/padding-right:\s*4px/);
    // The ACTIONS label is a word, so it must stay on one line instead of
    // wrapping into a taller header row.
    expect(actions[1]).toMatch(/white-space:\s*nowrap/);
  });

  test("the drag handle column is 24px wide", () => {
    const drag = styles.match(/\.drag-cell\s*\{([^}]*)\}/);
    expect(drag).not.toBeNull();
    expect(drag[1]).toMatch(/width:\s*24px/);
    expect(drag[1]).toMatch(/min-width:\s*24px/);
    expect(drag[1]).toMatch(/max-width:\s*24px/);
  });

  // Pinned identity cells: sticky against the pan, opaque so the columns
  // sliding underneath never show through.
  test("pins identity cells with an opaque background", () => {
    const cell = styles.match(/\.table-sticky-cell\s*\{([^}]*)\}/);
    expect(cell).not.toBeNull();
    expect(cell[1]).toMatch(/position:\s*sticky/);
    expect(cell[1]).toMatch(/z-index:\s*2/);
    expect(cell[1]).toMatch(/background-color:\s*var\(--surface\)/);
    // The per-column offset is written by the renderer from stickyOffsets().
    // The table scroller is the scrollport for both axes, so native sticky
    // keeps the cell fixed with no scroll offset folded in.
    expect(cell[1]).toMatch(
      /left:\s*var\(--table-sticky-left,?\s*0px\)/,
    );
    expect(cell[1]).not.toMatch(/table-sticky-scroll-x/);
  });

  // The sticky header owns the top of the table: pinned body cells stay
  // underneath it even though they stack above the scrolling columns.
  test("pinned header cells stack above the pinned body cells", () => {
    const head = styles.match(/thead \.table-sticky-cell\s*\{([^}]*)\}/);
    expect(head).not.toBeNull();
    expect(head[1]).toMatch(/z-index:\s*5/);
    // The header keeps its own surface instead of the row surface.
    expect(head[1]).toMatch(/background-color:\s*var\(--surface-3\)/);

    const thead = styles.match(/\nthead\s*\{([^}]*)\}/);
    expect(thead).not.toBeNull();
    const theadZ = Number(thead[1].match(/z-index:\s*(\d+)/)?.[1]);
    expect(theadZ).toBeGreaterThan(2);
  });

  // The thumbnail bubble is absolutely positioned inside the pinned thumbnail
  // cell. A pinned cell is its own stacking context, so without lifting the
  // cell the bubble slips under the catalog number in the same row and under
  // the pinned cells of the rows below. The header must stay above it.
  test("the thumbnail preview clears the pinned columns but not the header", () => {
    const cell = styles.match(
      /\.table-row-link:has\(\.table-thumb-preview\.is-visible\) > \.table-thumb-cell\s*\{([^}]*)\}/,
    );
    expect(cell).not.toBeNull();

    const cellZ = Number(cell[1].match(/z-index:\s*(\d+)/)?.[1]);
    expect(cellZ).toBeGreaterThan(2);

    const thead = styles.match(/\nthead\s*\{([^}]*)\}/);
    expect(thead).not.toBeNull();
    const theadZ = Number(thead[1].match(/z-index:\s*(\d+)/)?.[1]);
    expect(theadZ).toBeGreaterThan(cellZ);
  });

  // The edge shadow is the only thing that tells a collector the identity
  // block is pinned; it must not paint while the table sits at its start.
  test("the pan shadow only exists while the table is horizontally scrolled", () => {
    const rules = styles.match(/[^{}]*\.table-sticky-end::after[^{]*\{[^}]*\}/g);
    expect(rules).not.toBeNull();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/\.table-scroll-x\.is-scrolled-x/);
    expect(rules[0]).toMatch(/box-shadow:/);
  });

  // Row tints are layered over an opaque surface so a hovered or selected
  // pinned cell still blocks the columns panning beneath it.
  test("row tints keep the pinned cells opaque", () => {
    for (const rule of [
      /\.table-row-link:hover > \.table-sticky-cell[^{]*\{([^}]*)\}/,
      /\.table-row-link--selected > \.table-sticky-cell\s*\{([^}]*)\}/,
    ]) {
      const match = styles.match(rule);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/background-color:\s*var\(--surface\)/);
      expect(match[1]).toMatch(/background-image:\s*linear-gradient/);
    }
  });

  // The row's keyboard ring is drawn inside each cell; pinning must not turn
  // it into an outline or clip it at the sticky cell's edge.
  test("pinned cells keep the row's inset focus ring", () => {
    const ring = styles.match(
      /\.table-row-link--active > td\s*\{([^}]*box-shadow[^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[1]).toMatch(/inset 0 1px 0 var\(--accent\)/);

    const cell = styles.match(/\.table-sticky-cell\s*\{([^}]*)\}/);
    expect(cell[1]).not.toMatch(/outline:/);
    expect(cell[1]).not.toMatch(/overflow:\s*hidden/);

  });

  // The handle fills its whole cell in every defined state. Focusing a row
  // used to inset and round it, which made it narrower and shorter than the
  // handle on the rows around it.
  test("the drag handle keeps its full size and square shape when a row is focused", () => {
    // The base handle fills the cell and stays square; no row state may
    // override that with an inset or a rounded corner.
    const base = styles.match(/^\.drag-handle\s*\{([^}]*)\}/m);
    expect(base).not.toBeNull();
    expect(base[1]).toMatch(/inset:\s*0/);
    expect(base[1]).toMatch(/border-radius:\s*0/);
    // The base handle must not open a stacking context that would cover the
    // ring painted above it (see the next test).
    expect(base[1]).not.toMatch(/z-index/);

    expect(styles).not.toMatch(
      /\.(?:table-row-link|named-record-row)[^{}]*\.drag-handle[^{]*\{[^}]*(?:inset:|border-radius)/,
    );
    // A selected row is one of those states: its accent edge replaces the
    // handle shape, it does not round or inset it.
    expect(styles).not.toMatch(
      /\.table-row-link--selected[^{}]*\.drag-handle[^{]*\{[^}]*(?:inset:|border-radius)/,
    );
  });

  // The handle's opaque fill hides the drag cell's own inset shadow, so the
  // cell's share of the row ring has to be painted above the handle.
  test("the drag cell repaints the row ring above the handle", () => {
    const ring = styles.match(
      /\.table-row-link:focus-visible > td\.drag-cell::before,[\s\S]*?\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[0]).toMatch(/:has\(:focus-visible\)/);
    expect(ring[0]).toMatch(/\.table-row-link--active/);
    expect(ring[1]).toMatch(/position:\s*absolute/);
    expect(ring[1]).toMatch(/inset:\s*0/);
    expect(ring[1]).toMatch(/inset 0 1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 0 -1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 1px 0 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/pointer-events:\s*none/);
    expect(ring[1]).toMatch(/z-index:\s*1/);
  });

  // The collections table has the same reorder handle and needs the same
  // treatment; keep the two from drifting apart.
  test("the named-records drag cell repaints its row ring above the handle", () => {
    const ring = styles.match(
      /\.named-record-row:focus-visible > td\.named-records-drag-cell::before,[\s\S]*?\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[0]).toMatch(/:has\(:focus-visible\)/);
    expect(ring[0]).toMatch(/\.named-record-row--focused/);
    expect(ring[1]).toMatch(/content:\s*""/);
    expect(ring[1]).toMatch(/position:\s*absolute/);
    expect(ring[1]).toMatch(/inset:\s*0/);
    expect(ring[1]).toMatch(/inset 0 1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 0 -1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 1px 0 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/pointer-events:\s*none/);
    expect(ring[1]).toMatch(/z-index:\s*1/);
  });

  // Scanning: alignment comes from the column model, so the stylesheet owns
  // the three hooks and the cells carry the model's choice. Numbers line up
  // through tabular figures rather than centred text.
  test("text aligns left, numbers right and control columns centre", () => {
    const base = styles.match(/th,\s*td\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base[1]).toMatch(/text-align:\s*left/);
    expect(base[1]).toMatch(/font-variant-numeric:\s*tabular-nums/);

    expect(styles).toMatch(/\.align-left\s*\{\s*text-align:\s*left/);
    expect(styles).toMatch(/\.align-right\s*\{\s*text-align:\s*right/);
    expect(styles).toMatch(/\.align-center\s*\{\s*text-align:\s*center/);
    expect(styles).toMatch(
      /\.align-right \.sort-button\s*\{\s*justify-content:\s*flex-end/,
    );
    expect(styles).toMatch(
      /\.align-center \.sort-button\s*\{\s*justify-content:\s*center/,
    );
  });

  test("body rows are 48px at 14px text", () => {
    const bodyCells = styles.match(/tbody td\s*\{([^}]*)\}/);
    expect(bodyCells).not.toBeNull();
    expect(bodyCells[1]).toMatch(/height:\s*48px/);
    expect(bodyCells[1]).toMatch(/font-size:\s*14px/);
  });

  test("the drop placeholder stays a thin gap, not a body row", () => {
    const placeholder = styles.match(
      /\.table-drop-placeholder-row td\s*\{([^}]*)\}/,
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder[1]).toMatch(/height:\s*auto/);
  });

  test("thumbnails are 48x28 without distortion", () => {
    const thumb = styles.match(/\.table-thumb\s*\{([^}]*)\}/);
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/width:\s*48px/);
    expect(thumb[1]).toMatch(/height:\s*28px/);
    expect(thumb[1]).toMatch(/object-fit:\s*contain/);
  });

  test("the active sort header draws a chevron that flips on descending", () => {
    const chevron = styles.match(/\.sort-chevron\s*\{([^}]*)\}/);
    expect(chevron).not.toBeNull();
    expect(chevron[1]).toMatch(/flex:\s*0\s+0\s+auto/);
    expect(styles).toMatch(
      /th\[aria-sort="descending"\]\s+\.sort-chevron\s*\{[^}]*transform:\s*rotate\(180deg\)/,
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
    // Every cursor stop already draws its own ring, so the global
    // :focus-visible outline would double it. The outline is dropped only on
    // cursor stops; a plain Tab focus keeps the browser outline.
    expect(styles).toMatch(/\.sidebar-link--cursor:focus-visible/);
    expect(styles).toMatch(/\.sidebar-reorder-toggle--cursor:focus-visible/);
    expect(styles).toMatch(/\.sidebar-move-button--cursor:focus-visible/);
    expect(styles).toMatch(/outline:\s*none/);
  });

  test("the reorder toggle and move buttons ring the keyboard cursor", () => {
    expect(styles).toMatch(
      /\.sidebar-reorder-toggle--cursor\s*\{[^}]*box-shadow:\s*inset 0 0 0 1\.5px var\(--accent\)/,
    );
    expect(styles).toMatch(
      /\.sidebar-move-button--cursor\s*\{[^}]*box-shadow:\s*inset 0 0 0 1\.5px var\(--accent\)/,
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

  // The app follows the window with no breakpoint-specific layout: narrow
  // windows shrink the main area, so there are no width-based media queries
  // and no narrow-screen drawer to conflict with the "b" rail shortcut.
  test("has no width-based media queries", () => {
    expect(styles).not.toMatch(/@media\s*\((max|min)-width/);
  });

  test("has no drawer, hamburger, or backdrop selectors", () => {
    expect(styles).not.toMatch(/drawer-open/);
    expect(styles).not.toMatch(/\.sidebar-hamburger/);
    expect(styles).not.toMatch(/\.sidebar-backdrop/);
  });
});

describe("app viewport width", () => {
  // The app follows the window instead of holding a desktop-sized floor. On a
  // narrow browser window the main area shrinks and the Table screen's own
  // horizontal scroller reaches every column; the Tauri shell keeps its
  // minimum window width, so this only changes the web build.
  test("the body does not hold a fixed-width floor", () => {
    const body = styles.match(/body\s*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body[1]).not.toMatch(/min-width:\s*\d+px/);
  });

  test("the body still crops the page scrollbar", () => {
    const body = styles.match(/body\s*\{([^}]*)\}/);
    expect(body).not.toBeNull();
    expect(body[1]).toMatch(/overflow:\s*hidden/);
    expect(body[1]).not.toMatch(/overflow-x:\s*auto/);
  });

  test("the app shell follows the viewport width", () => {
    const shell = styles.match(/\.app-shell\s*\{([^}]*)\}/);
    expect(shell).not.toBeNull();
    expect(shell[1]).toMatch(/width:\s*100%/);
    expect(shell[1]).not.toMatch(/min-width:\s*\d+px/);
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

  // Fixed overlays size against the viewport. Each overlay freezes its
  // content at a desktop rendering and scrolls instead of reflowing on
  // smaller windows.
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

  test("the image popover content owns the on-dark text colour", () => {
    // The popover mounts standalone in the showcase, outside the slideshow
    // scrim that used to supply the text colour: without its own colour the
    // arrows, counter, and note label inherit the host's dark text and fade
    // into the dark background.
    const content = styles.match(/\.image-popover-content\s*\{([^}]*)\}/);
    expect(content).not.toBeNull();
    expect(content[1]).toMatch(/color:\s*var\(--on-dark-text\)/);
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
