import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

// jsdom cannot resolve `:hover` from a stylesheet, so the hover rule is
// pinned here as a static contract over the source instead of a rendered
// assertion.
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

describe("table styles", () => {
  test("defines the zebra row tint token", () => {
    expect(styles).toMatch(
      /--row-zebra:\s*rgba\(37,\s*40,\s*43,\s*0\.035\)/,
    );
  });

  test("odd rows carry the zebra tint", () => {
    expect(styles).toMatch(
      /\.table-row-link--zebra\s*\{\s*background:\s*var\(--row-zebra\)/,
    );
  });

  // Selected rows sit a shade stronger than the hover wash (0.09 against
  // 0.07). The accent edge and the checkbox still carry the selection state.
  test("the selected row tint is darker than the hover tint", () => {
    expect(styles).toMatch(
      /--row-selected:\s*rgba\(230,\s*0,\s*0,\s*0\.09\)/,
    );
    expect(styles).toMatch(
      /--accent-soft:\s*rgba\(230,\s*0,\s*0,\s*0\.07\)/,
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
  // cell's `::before`, not the checkbox cell, and the drag cell pins so the
  // edge stays put while the columns pan. The handle paints an opaque surface
  // over the whole cell, so the edge is a pseudo-element stacked above it,
  // outside the interaction rules and never in the way of the drag target.
  // Keeping it off `::after` leaves the end-of-block divider untouched on
  // selected rows.
  test("the selected edge sits on the pinned drag cell above the handle", () => {
    const cell = styles.match(/td\.drag-cell\s*\{([^}]*)\}/);
    expect(cell).not.toBeNull();
    expect(cell[1]).toMatch(/position:\s*sticky/);

    const edge = styles.match(
      /\.table-row-link--selected > td\.drag-cell::before,[\s\S]*?\{([^}]*)\}/,
    );
    expect(edge).not.toBeNull();
    expect(edge[1]).toMatch(/content:\s*""/);
    expect(edge[1]).toMatch(/position:\s*absolute/);
    expect(edge[1]).toMatch(/inset:\s*0/);
    expect(edge[1]).toMatch(/z-index:\s*1/);
    expect(edge[1]).toMatch(/pointer-events:\s*none/);

    const accent = styles.match(
      /\.table-row-link--selected > td\.drag-cell::before\s*\{([^}]*)\}/,
    );
    expect(accent).not.toBeNull();
    expect(accent[1]).toMatch(
      /linear-gradient\(var\(--accent\),\s*var\(--accent\)\)\s*left\s*\/\s*3px\s+100%/,
    );

    // The end-of-block divider is owned by the pinned-cell rule scoped to the
    // last pinned column, so no selected-row override may replace it.
    expect(styles).not.toMatch(
      /\.table-row-link--selected > td\.drag-cell::after/,
    );
    expect(styles).toMatch(
      /\.table-sticky-cell\.table-sticky-end::after\s*\{[^}]*right:\s*0;[^}]*width:\s*1px;[^}]*background:\s*var\(--border-soft\)/,
    );
    // Every pinned cell must not paint a divider of its own: the column
    // hairlines come from the model's classes, and only the last pinned
    // column adds the block's end marker.
    expect(styles).not.toMatch(/\.table-sticky-cell::after\s*\{/);
    expect(styles).not.toMatch(/\.table-sticky-lead/);
  });

  // Keyboard focus on a row checkbox is a halo behind the box, not an offset
  // outline around it. The native control paints a square white background
  // behind its rounded border, so those corners would show as notches inside
  // the halo; clipping the control removes them, and the halo is painted on
  // the cell because `clip-path` would clip a shadow on the input.
  test("the row checkbox draws focus as a clipped halo on the cell", () => {
    const clipped = styles.match(
      /\.table-sticky-cell\.align-center > input\[type="checkbox"\]\s*\{([^}]*)\}/,
    );
    expect(clipped).not.toBeNull();
    expect(clipped[1]).toMatch(/clip-path:\s*inset\(0 round 4px\)/);
    expect(clipped[1]).toMatch(/z-index:\s*1/);

    // Collapsing the cell's strut centres the inline checkbox on the halo.
    // The `:has` guard keeps the centred thumbnail column on its own rhythm.
    const cell = styles.match(
      /\.table-sticky-cell\.align-center:has\(> input\[type="checkbox"\]\)\s*\{([^}]*)\}/,
    );
    expect(cell).not.toBeNull();
    expect(cell[1]).toMatch(/line-height:\s*0/);

    const reset = styles.match(
      /\.table-sticky-cell\.align-center > input\[type="checkbox"\]:focus-visible\s*\{([^}]*)\}/,
    );
    expect(reset).not.toBeNull();
    expect(reset[1]).toMatch(/outline:\s*none/);

    const halo = styles.match(
      /\.table-sticky-cell\.align-center:has\(> input\[type="checkbox"\]:focus-visible\)::before\s*\{([^}]*)\}/,
    );
    expect(halo).not.toBeNull();
    expect(halo[1]).toMatch(/position:\s*absolute/);
    expect(halo[1]).toMatch(
      /background:\s*rgba\(230,\s*0,\s*0,\s*0\.24\)/,
    );
    expect(halo[1]).toMatch(/pointer-events:\s*none/);
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

  // The prototype's sort control sits on the label, not on the whole column
  // head: it hugs the text and is pulled 6px left so the label still lines up
  // with the cell padding.
  test("sort buttons hug their label instead of filling the cell", () => {
    const button = styles.match(/\.sort-button\s*\{([^}]*)\}/);
    expect(button).not.toBeNull();
    expect(button[1]).toMatch(/display:\s*inline-flex/);
    expect(button[1]).not.toMatch(/width:\s*100%/);
    expect(button[1]).toMatch(/margin-left:\s*-6px/);
    expect(styles).not.toMatch(/th:has\(\.sort-button\)/);
  });

  test("sort bubbles leave breathing room around the label", () => {
    expect(styles).toMatch(
      /\.sort-button\s*\{[^}]*padding:\s*4px 6px[^}]*border-radius:\s*7px/,
    );
  });

  // The display-order column is compact (4px of padding), so the header's wide
  // 12px band must not win, and the sort button's usual 6px pull would push it
  // and its 2px ring past the cell's right edge, where the next pinned header
  // paints over the ring.
  test("the compact order header keeps its sort ring inside the cell", () => {
    expect(styles).toMatch(
      /\.table-shell thead th\.table-order-cell\s*\{[^}]*padding-left:\s*4px[^}]*padding-right:\s*4px/,
    );

    const button = styles.match(/\.table-order-cell \.sort-button\s*\{([^}]*)\}/);
    expect(button).not.toBeNull();
    expect(button[1]).toMatch(/margin-inline:\s*0/);
    expect(button[1]).toMatch(/padding:\s*4px/);
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

  // The scoped filter field is table chrome now, so it sits on the same 36px
  // band as the column filters instead of the old 40px toolbar bar. It is a
  // fixed 400px: the rail's primary control, so neither the hint's length nor
  // the trailing cluster decides its width.
  test("the scoped field matches the column filters' height and flex basis", () => {
    const search = styles.match(/^\.table-search-input\s*\{([^}]*)\}/m);
    expect(search).not.toBeNull();
    expect(search[1]).toMatch(/height:\s*36px/);

    const scoped = styles.match(/^\.table-search--scoped\s*\{([^}]*)\}/m);
    expect(scoped).not.toBeNull();
    expect(scoped[1]).toMatch(/flex:\s*0 0 400px/);
    expect(scoped[1]).toMatch(/width:\s*min\(400px,\s*100%\)/);
    expect(scoped[1]).toMatch(/min-width:\s*240px/);
    expect(scoped[1]).toMatch(/height:\s*36px/);

    const filter = styles.match(/\.filter-input\s*\{([^}]*)\}/);
    expect(filter).not.toBeNull();
    expect(filter[1]).toMatch(/min-height:\s*36px/);
    expect(filter[1]).toMatch(/padding:\s*0\s+10px/);
    expect(filter[1]).toMatch(/line-height:\s*normal/);

    const tags = styles.match(/\.tags-filter-chips-scroll\s*\{([^}]*)\}/);
    expect(tags).not.toBeNull();
    expect(tags[1]).toMatch(/min-height:\s*34px/);

    // The borderless input inside the tags combobox must not inherit the
    // outer filter's 36px min-height, or the combobox would grow past 36px.
    const tagsInput = styles.match(
      /\.tags-filter-combobox \.tags-filter-input\s*\{([^}]*)\}/,
    );
    expect(tagsInput).not.toBeNull();
    expect(tagsInput[1]).toMatch(/min-height:\s*0/);
  });

  // The placeholder takes the same AA tone as every other quiet field. The
  // prototype's lighter hint tone measured 2.34:1 on this ground.
  test("the filter input placeholder uses the AA-safe tone", () => {
    const placeholder = styles.match(
      /^\.table-search-input::placeholder\s*\{([^}]*)\}/m,
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder[1]).toMatch(/color:\s*var\(--text-faint\)/);
    expect(styles).not.toMatch(/\.table-search--scoped \.table-search-input::placeholder/);
    expect(styles).not.toMatch(/--text-hint/);
    expect(styles).not.toMatch(/\.table-filter-chips-empty/);
  });

  // The idle rule is prose in the rail, in the chips' own slot: no trigger to
  // lose track of on the far edge and no popover frame to reuse.
  test("the idle filter hint rides in the chips' slot", () => {
    expect(styles).not.toMatch(/\.table-filter-help/);
    expect(styles).not.toMatch(/\.table-filter-menu--note/);

    const hint = styles.match(/^\.table-filter-hint\s*\{([^}]*)\}/m);
    expect(hint).not.toBeNull();
    expect(hint[1]).toMatch(/flex:\s*1 1 240px/);
    expect(hint[1]).toMatch(/min-width:\s*0/);
    // The 24px row is the chip line's own height, so the first chip replaces
    // the sentence without moving the table.
    expect(hint[1]).toMatch(/min-height:\s*24px/);
    // The only sentence that explains the model has to read as text, not as
    // texture: --text-faint is 4.96:1 on the rail.
    expect(hint[1]).toMatch(/color:\s*var\(--text-faint\)/);
    expect(hint[1]).toMatch(/font-size:\s*0\.75rem/);

    // Both connectors are one role: the word that joins two chips, 11px/600 in
    // sentence case at the muted tone. Only their side padding differs.
    const connectors = styles.match(
      /^\.table-filter-or,\s*\.table-filter-and\s*\{([^}]*)\}/m,
    );
    expect(connectors).not.toBeNull();
    expect(connectors[1]).toMatch(/color:\s*var\(--text-muted\)/);
    expect(connectors[1]).toMatch(/font-size:\s*0\.6875rem/);
    expect(connectors[1]).toMatch(/font-weight:\s*600/);
    expect(connectors[1]).toMatch(/letter-spacing:\s*0\.06em/);
    expect(connectors[1]).not.toMatch(/font-style:\s*italic/);
    expect(connectors[1]).not.toMatch(/text-transform:\s*uppercase/);
  });

  // The filters describe only the table, so they are the card's own rail: the
  // field leads, the chips take the middle and wrap there, and the trailing
  // Add note / Reset / Columns cluster keeps the right edge. Rail padding stays
  // above the field's 3px focus glow, which `.table-shell { overflow: hidden }`
  // would otherwise crop.
  test("the filter bar rides in the table card's rail", () => {
    const rail = styles.match(/^\.table-rail\s*\{([^}]*)\}/m);
    expect(rail).not.toBeNull();
    expect(rail[1]).toMatch(/display:\s*flex/);
    expect(rail[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(rail[1]).toMatch(/align-items:\s*center/);
    expect(rail[1]).toMatch(/gap:\s*8px 12px/);
    expect(rail[1]).toMatch(/padding:\s*6px 10px/);
    expect(rail[1]).toMatch(/flex:\s*0 0 auto/);
    expect(rail[1]).toMatch(/border-bottom:\s*1px solid var\(--border\)/);
    expect(rail[1]).toMatch(/background:\s*var\(--surface-2\)/);
    expect(rail[1]).not.toMatch(/overflow:\s*hidden/);

    const actions = styles.match(/^\.table-rail-actions\s*\{([^}]*)\}/m);
    expect(actions).not.toBeNull();
    expect(actions[1]).toMatch(/display:\s*flex/);
    expect(actions[1]).toMatch(/gap:\s*8px/);
    expect(actions[1]).toMatch(/flex:\s*0 0 auto/);
    expect(actions[1]).toMatch(/margin-left:\s*auto/);

    // The primary action leads the cluster, so it is reached before the view
    // controls while Columns still owns the card's right edge.
    const addNote = styles.match(/^\.table-add-note\s*\{([^}]*)\}/m);
    expect(addNote).not.toBeNull();
    expect(addNote[1]).toMatch(/gap:\s*6px/);
    expect(addNote[1]).toMatch(/white-space:\s*nowrap/);

    // The shared hover badge opens downward here: the rail is inside the
    // shell's overflow clip, so the default badge above the button would vanish.
    const addNoteBadge = styles.match(
      /\.table-add-note\[data-shortcut\]::after\s*\{([^}]*)\}/,
    );
    expect(addNoteBadge).not.toBeNull();
    expect(addNoteBadge[1]).toMatch(/top:\s*calc\(100% \+ 8px\)/);
    expect(addNoteBadge[1]).toMatch(/bottom:\s*auto/);

    // The chips grow into the middle of the rail and wrap inside it. Nothing
    // reserves their old 30px line: the rail's own height is the card's edge.
    // The 8px row-gap keeps a wrapped line at 24 + 8 = 32px.
    const chips = styles.match(/^\.table-filter-chips\s*\{([^}]*)\}/m);
    expect(chips).not.toBeNull();
    expect(chips[1]).toMatch(/flex-wrap:\s*wrap/);
    expect(chips[1]).toMatch(/flex:\s*1 1 240px/);
    expect(chips[1]).toMatch(/gap:\s*8px 4px/);
    expect(chips[1]).toMatch(/min-width:\s*0/);
    expect(chips[1]).toMatch(/margin:\s*0/);
    expect(chips[1]).not.toMatch(/min-height/);

    // The old toolbar band left with the filter bar that used it.
    expect(styles).not.toMatch(/\.toolbar-row--table-controls/);
  });

  // A cramped rail stops negotiating: the field and the trailing controls take
  // the first row and the chips get a row of their own, so the same six filters
  // read the same at every width below the breakpoint instead of flowing into a
  // different shape at each one. The query sits on the card, not the viewport,
  // because the collapsed sidebar and the page padding are part of the budget.
  test("a narrow card stacks the chips under the field", () => {
    const shell = styles.match(/^\.table-shell\s*\{([^}]*)\}/m);
    expect(shell).not.toBeNull();
    expect(shell[1]).toMatch(/container-type:\s*inline-size/);
    expect(shell[1]).toMatch(/container-name:\s*table-shell/);

    const narrow = atRule(styles, "@container table-shell (max-width: 1120px)");
    expect(narrow).not.toBeNull();

    // The chips stop competing with the field: 100% basis forces their own
    // line, and `order` follows the visual stack while the DOM keeps chips
    // before Add note / Reset view / Columns for the keyboard.
    const chips = narrow.match(
      /\.table-filter-chips,\s*\.table-filter-hint\s*\{([^}]*)\}/,
    );
    expect(chips).not.toBeNull();
    expect(chips[1]).toMatch(/order:\s*2/);
    expect(chips[1]).toMatch(/flex:\s*1 1 100%/);

    const actions = narrow.match(
      /\.table-rail-actions\s*\{([^}]*)\}/,
    );
    expect(actions).not.toBeNull();
    expect(actions[1]).toMatch(/order:\s*1/);

    // The query can only win by source order: both selectors are a single
    // class, so the block has to sit after the rules it overrides.
    const queryAt = styles.indexOf("@container table-shell");
    expect(queryAt).toBeGreaterThan(styles.indexOf(".table-rail-actions {"));
    expect(queryAt).toBeGreaterThan(styles.indexOf(".table-filter-chips {"));
  });

  // The idle hint is longer than the gap left beside the field once the
  // trailing cluster needs its row, so it takes the chips' row too. One narrow
  // shape in both states: the hint's length never decides the field's width,
  // the cluster never floats alone, and the rail changes height only at the
  // breakpoint.
  test("the idle hint shares the narrow rail's second row", () => {
    const narrow = atRule(styles, "@container table-shell (max-width: 1120px)");
    expect(narrow).not.toBeNull();
    expect(narrow).toMatch(
      /\.table-filter-chips,\s*\.table-filter-hint\s*\{[^}]*order:\s*2/,
    );
    expect(narrow).toMatch(/\.table-rail-actions\s*\{[^}]*order:\s*1/);

    // The field is the primary control, so it holds its width: a shrinking
    // basis let the hint's length set it (400 at 1180, 372 at 1100).
    const field = styles.match(/^\.table-search--scoped\s*\{([^}]*)\}/m);
    expect(field).not.toBeNull();
    expect(field[1]).toMatch(/flex:\s*0 0 400px/);

    // One breakpoint, not two: the second query re-introduced the instability.
    expect(styles).not.toMatch(/@container table-shell \(max-width: 900px\)/);
  });

  // A connector names the chip that follows it, so prefix and chip wrap as one
  // unit: a line may start with "AND Company PM" but never ends on a bare
  // "and". One chip per unit is also what lets a long run of ORed values wrap
  // between chips instead of overflowing under the rail's controls.
  test("a connector travels with its chip", () => {
    const unit = styles.match(/^\.table-filter-unit\s*\{([^}]*)\}/m);
    expect(unit).not.toBeNull();
    expect(unit[1]).toMatch(/display:\s*inline-flex/);
    expect(unit[1]).toMatch(/align-items:\s*center/);
    expect(unit[1]).toMatch(/flex:\s*0 0 auto/);
  });

  // Add note leads the cluster, then Reset sits before Columns and no slot
  // reserves its space, so Columns keeps the card's right edge whether or not
  // the view is dirty, and the rail never shows a hole for a control that is
  // not there.
  test("the rail reserves no slot for the reset control", () => {
    expect(styles).not.toMatch(/\.table-reset-slot/);

    const reset = styles.match(/^\.table-reset-view\s*\{([^}]*)\}/m);
    expect(reset).not.toBeNull();
    expect(reset[1]).toMatch(/gap:\s*6px/);
  });

  // An empty view is a message, not a missing page: the table stretches to the
  // scrollport so the message centres in the rows region. The class is set from
  // the rendered row counts, so a deferred frame that still holds stale rows
  // never stretches them. The cell spans the table's 1200px floor, which can be
  // wider than the card, so the frame pins to the visible scrollport instead of
  // centring somewhere past the card's right edge.
  test("the empty state centres in the rows region", () => {
    expect(styles).toMatch(
      /\.table-scroll-content\.is-empty-view\s*\{\s*height:\s*100%/,
    );
    expect(styles).toMatch(
      /\.table-scroll-content\.is-empty-view\s*>\s*table\s*\{[^}]*height:\s*100%/,
    );

    const cell = styles.match(/^\.table-empty-cell\s*\{([^}]*)\}/m);
    expect(cell).not.toBeNull();
    expect(cell[1]).toMatch(/vertical-align:\s*middle/);
    // The frame owns the inline insets now, so the cell must not add its own.
    expect(cell[1]).toMatch(/padding:\s*32px 0/);

    const frame = styles.match(/^\.table-empty-frame\s*\{([^}]*)\}/m);
    expect(frame).not.toBeNull();
    expect(frame[1]).toMatch(/position:\s*sticky/);
    expect(frame[1]).toMatch(/left:\s*0/);
    expect(frame[1]).toMatch(/width:\s*min\(100%,\s*100cqw\)/);
    expect(frame[1]).toMatch(/padding:\s*0 16px/);
  });

  // A body cell is one line. The virtualizer places rows at a fixed 45px and
  // never measures them, so a pasted 200-character denomination would wrap its
  // row past its own slot and shift every row below it. The cell clips with an
  // ellipsis instead; the full value travels in the cell's title.
  test("body cells clip a long value to one line", () => {
    const cells = styles.match(/^\.table-row-link > td\s*\{([^}]*)\}/m);
    expect(cells).not.toBeNull();
    expect(cells[1]).toMatch(/overflow:\s*hidden/);
    expect(cells[1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(cells[1]).toMatch(/white-space:\s*nowrap/);

    // The empty view's cell wraps its message and must not inherit the clip.
    const emptyCell = styles.match(/^\.table-empty-cell\s*\{([^}]*)\}/m);
    expect(emptyCell).not.toBeNull();
    expect(emptyCell[1]).not.toMatch(/text-overflow/);
  });

  // The thumbnail cell holds an image, never a value the body ellipsis could
  // truncate. The 56px image overflows the 55px content box by a pixel, and
  // Chrome would paint the ellipsis as a lone dot against the cell's edge.
  test("the thumbnail cell clips without a truncation ellipsis", () => {
    const thumb = styles.match(
      /^\.table-row-link > \.table-thumb-cell\s*\{([^}]*)\}/m,
    );
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/text-overflow:\s*clip/);
  });

  // A filter value pasted from a grading page can be longer than the rail. The
  // unit caps itself at the chip line, the chip gives way, and the value ends
  // in an ellipsis so its remove cross stays on the card.
  test("a long filter value clips inside its chip", () => {
    const unit = styles.match(/^\.table-filter-unit\s*\{([^}]*)\}/m);
    expect(unit).not.toBeNull();
    expect(unit[1]).toMatch(/max-width:\s*100%/);

    const chip = styles.match(/^\.table-filter-chip\s*\{([^}]*)\}/m);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/flex:\s*0 1 auto/);
    expect(chip[1]).toMatch(/min-width:\s*0/);

    const value = styles.match(/^\.table-filter-chip-value\s*\{([^}]*)\}/m);
    expect(value).not.toBeNull();
    expect(value[1]).toMatch(/overflow:\s*hidden/);
    expect(value[1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(value[1]).toMatch(/white-space:\s*nowrap/);

    const remove = styles.match(/^\.table-filter-chip-remove\s*\{([^}]*)\}/m);
    expect(remove).not.toBeNull();
    expect(remove[1]).toMatch(/flex:\s*0 0 auto/);
  });

  // A failed load keeps the table's footprint instead of leaving the page as a
  // single red line, and its message can carry an unbroken server path.
  test("the load-error panel keeps the card and wraps its detail", () => {
    const panel = styles.match(/^\.table-load-error\s*\{([^}]*)\}/m);
    expect(panel).not.toBeNull();
    expect(panel[1]).toMatch(/justify-content:\s*center/);

    const detail = styles.match(/^\.table-load-error-detail\s*\{([^}]*)\}/m);
    expect(detail).not.toBeNull();
    expect(detail[1]).toMatch(/overflow-wrap:\s*anywhere/);
  });

  // The editor's tag row and the filter row share one Clear all, so the hover
  // stays in the warm accent family and no second, drifting rule exists.
  test("clear-all hover stays in the accent family", () => {
    const rule = styles.match(/\.table-filter-clear-all:hover\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(rule[1]).not.toMatch(/var\(--text\)/);
    expect(styles).not.toMatch(/\.tags-filter-clear-all\s*\{/);
  });

  // The note editor's tag chips reuse the filter chip metrics rather than
  // carrying a second set that can drift. Only the value's cursor and weight
  // differ, because it is not an in-place editor inside `.field-block`.
  test("the editor's tag chips defer to the filter chip rules", () => {
    expect(styles).not.toMatch(/\.tags-filter-chip\s*\{/);
    const value = styles.match(
      /\.tags-filter-chip\s+\.table-filter-chip-value\s*\{([^}]*)\}/,
    );
    expect(value).not.toBeNull();
    expect(value[1]).toMatch(/cursor:\s*default/);
    expect(value[1]).toMatch(/font-weight:\s*600/);
  });

  // The tags field has no in-place editor, so keyboard focus rings the whole
  // chip. It wears the app's normal 2px accent ring with a clear gap, the same
  // way a focused tag reads in the table.
  test("keyboard focus rings the whole tag chip with a gap", () => {
    const ring = styles.match(
      /\.tags-filter-chip:has\(:focus-visible\)\s*\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[1]).not.toMatch(/border-color:/);
    expect(ring[1]).toMatch(/outline:\s*2px solid var\(--tag-text\)/);
    expect(ring[1]).toMatch(/outline-offset:\s*2px/);

    // The cross draws no ring of its own; the chip's ring marks the focus.
    expect(styles).toMatch(
      /\.tags-filter-chip \.table-filter-chip-remove:focus-visible\s*\{\s*outline:\s*none/,
    );
  });

  // The ring sits 2px off the chip, so the scroll row has to leave it room or
  // `overflow-y` shaves the outer edge and the gap reads as a tight border.
  test("the chips row leaves room for the offset ring", () => {
    const scroll = styles.match(/\.tags-filter-chips-scroll\s*\{([^}]*)\}/);
    expect(scroll).not.toBeNull();
    expect(scroll[1]).toMatch(/padding:\s*5px\s+8px/);
  });

  // Suggestions below the editor's tags field are the same chip as the ones
  // above it: the button carries `.table-filter-chip` for the surface, and
  // this rule only adds the padding the chip's inner value would supply.
  test("tag suggestions use the filter chip surface", () => {
    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/height:\s*24px/);
    expect(chip[1]).toMatch(/border-radius:\s*7px/);
    expect(chip[1]).toMatch(/background:\s*var\(--tag-bg\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--tag-text\)/);

    const button = styles.match(/^\.suggestion-tag\s*\{([^}]*)\}/m);
    expect(button).not.toBeNull();
    expect(button[1]).toMatch(/padding:\s*0\s+8px/);
    expect(button[1]).toMatch(/font-size:\s*0\.75rem/);
    expect(button[1]).toMatch(/font-weight:\s*600/);
    expect(button[1]).toMatch(/cursor:\s*pointer/);
    // No second surface of its own: the `.tag` pill must not repaint it.
    expect(styles).not.toMatch(/\.tag\.suggestion-tag\s*\{/);
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

  test("label-row headers use wide-tracked caps", () => {
    const head = styles.match(/\.table-shell thead th\s*\{([^}]*)\}/);
    expect(head).not.toBeNull();
    expect(head[1]).toMatch(/font-weight:\s*700/);
    expect(head[1]).toMatch(/font-size:\s*0\.6875rem/);
    expect(head[1]).toMatch(/letter-spacing:\s*0\.08em/);
    expect(head[1]).toMatch(/text-transform:\s*uppercase/);
    // 11px caps are small text, so the caption has to clear 4.5:1 on the
    // header band: the umber token does, the prototype's #8a755a did not.
    expect(head[1]).toMatch(/color:\s*var\(--text-muted\)/);
  });

  // A single-class align-* rule is weaker than `.table-shell thead th`, so an
  // explicit text-align here would silently left-align the right-aligned `#`
  // header and the centred thumbnail header. The same goes for tracking: the
  // older first-child rule outranks the band, so it must not declare any.
  test("the header band leaves alignment and tracking to their owners", () => {
    const head = styles.match(/\.table-shell thead th\s*\{([^}]*)\}/);
    expect(head).not.toBeNull();
    expect(head[1]).not.toMatch(/text-align:/);

    const firstChild = styles.match(/thead tr:first-child th\s*\{([^}]*)\}/);
    expect(firstChild).not.toBeNull();
    expect(firstChild[1]).not.toMatch(/letter-spacing:/);
    expect(firstChild[1]).not.toMatch(/font-weight:/);
  });

  // Filter chips stay legible at rest: the field label reads as a label, every
  // value chip carries the tag family whether it names a catalogue number or a
  // tag, and a negation stays in the danger family.
  test("filter chips wear the tag family", () => {
    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/background:\s*var\(--tag-bg\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--tag-text\)/);
    expect(chip[1]).toMatch(/border:\s*1px solid var\(--tag-border\)/);

    const label = styles.match(/\.table-filter-facet-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/color:\s*var\(--text-muted\)/);

    const negated = styles.match(/\.table-filter-chip--negated\s*\{([^}]*)\}/);
    expect(negated).not.toBeNull();
    expect(negated[1]).toMatch(/var\(--danger\)/);
    // A negation has to outrank the tag family, or a `!tag` would lose its
    // danger ground.
    expect(styles.indexOf(".table-filter-chip {")).toBeLessThan(
      styles.indexOf(".table-filter-chip--negated {"),
    );
  });

  // The chip row's metrics: a 24px unit around the 24px value chip, 12px
  // labels and an 11px "and" separator. A wrapped chip line is therefore the
  // 24px row plus the chips' 8px row-gap, matching the ADR's 32px.
  test("the chip row's metrics", () => {
    const unit = styles.match(/\.table-filter-unit\s*\{([^}]*)\}/);
    expect(unit).not.toBeNull();
    expect(unit[1]).toMatch(/height:\s*24px/);
    expect(unit[1]).toMatch(/gap:\s*5px/);

    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/height:\s*24px/);

    const label = styles.match(/\.table-filter-facet-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/font-size:\s*0\.75rem/);
    expect(label[1]).toMatch(/font-weight:\s*650/);

    // The two connectors share one rule; only their side padding differs.
    const and = styles.match(
      /(?<!\.table-filter-or,\n)\.table-filter-and \{([^}]*)\}/,
    );
    expect(and).not.toBeNull();
    expect(and[1]).toMatch(/padding:\s*0\s+8px/);

    const or = styles.match(/\.table-filter-or \{([^}]*)\}/);
    expect(or).not.toBeNull();
    expect(or[1]).toMatch(/padding:\s*0\s+3px/);

    const clear = styles.match(/\.table-filter-clear-all\s*\{([^}]*)\}/);
    expect(clear).not.toBeNull();
    expect(clear[1]).toMatch(/color:\s*var\(--accent\)/);
    expect(clear[1]).toMatch(/margin-left:\s*6px/);

    // The remove cross is drawn, not typed, so it centres in its 17px target.
    const cross = styles.match(/\.table-filter-chip-remove svg\s*\{([^}]*)\}/);
    expect(cross).not.toBeNull();
    expect(cross[1]).toMatch(/display:\s*block/);
    expect(cross[1]).toMatch(/width:\s*8px/);
  });

  // Tabbing to a filter chip's remove cross should light it up exactly like a
  // mouse hover: the same round Ochre wash. It is its own target, so it gets
  // its own ring, separate from the value's ring beside it.
  test("keyboard focus on a chip cross matches its hover state", () => {
    const button = styles.match(/^\.table-filter-chip-remove\s*\{([^}]*)\}/m);
    expect(button).not.toBeNull();
    // A circle, not a rounded square: the wash follows the 17px exit.
    expect(button[1]).toMatch(/border-radius:\s*var\(--radius-pill\)/);

    const fill = styles.match(
      /\.table-filter-chip-remove:hover,\s*\.table-filter-chip-remove:focus-visible\s*\{([^}]*)\}/,
    );
    expect(fill).not.toBeNull();
    expect(fill[1]).toMatch(/background:\s*rgba\(122, 79, 0, 0\.14\)/);
    expect(fill[1]).toMatch(/color:\s*var\(--tag-text\)/);

    const ring = styles.match(
      /\.table-filter-chip-remove:focus-visible\s*\{\s*outline:\s*2px solid var\(--tag-text\)/,
    );
    expect(ring).not.toBeNull();
  });

  // The value is what the filter chip is for, so editing it rings the whole
  // chip: a 2px Ochre outline, 2px off the border, that a focused tag in the
  // table wears. The cross keeps its own ring of the same tone.
  test("editing a filter chip rings the whole chip", () => {
    const value = styles.match(/^\.table-filter-chip-value\s*\{([^}]*)\}/m);
    expect(value).not.toBeNull();
    expect(value[1]).toMatch(/height:\s*22px/);
    expect(value[1]).toMatch(/border-radius:\s*6px 0 0 6px/);

    const ring = styles.match(
      /\.table-filter-chip:has\(\.table-filter-chip-value:focus-visible\),[^{]*\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[0]).toMatch(/\.table-filter-chip-input:focus-visible/);
    expect(ring[1]).toMatch(/outline:\s*2px solid var\(--tag-text\)/);
    expect(ring[1]).toMatch(/outline-offset:\s*2px/);

    // The slice itself draws no second, inset ring.
    expect(styles).toMatch(
      /\.table-filter-chip \.table-filter-chip-value:focus-visible\s*\{\s*outline:\s*none/,
    );
  });

  // Tag suggestions float on their own surface, and the create arm is split
  // off by a dashed rule.
  test("tag suggestions keep the floating list look", () => {
    const dropdown = styles.match(/\.tags-filter-dropdown\s*\{([^}]*)\}/);
    expect(dropdown).not.toBeNull();
    expect(dropdown[1]).toMatch(/border-radius:\s*var\(--radius-md\)/);
    expect(dropdown[1]).toMatch(/box-shadow:\s*var\(--shadow-md\)/);

    const create = styles.match(
      /\.tags-filter-option--create\s*\{([^}]*)\}/,
    );
    expect(create).not.toBeNull();
    expect(create[1]).toMatch(/font-weight:\s*700/);

    const rule = styles.match(
      /\.tags-filter-option--create::before\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(
      /border-top:\s*1px dashed var\(--border-control\)/,
    );
  });

  // A long tag list must not fall back to the platform's chunky bar: the
  // dropdown draws a slim rounded thumb, and Firefox gets the thin variant.
  test("tag suggestion lists scroll with a slim custom bar", () => {
    const dropdown = styles.match(/\.tags-filter-dropdown\s*\{([^}]*)\}/);
    expect(dropdown).not.toBeNull();
    expect(dropdown[1]).toMatch(/scrollbar-width:\s*thin/);
    expect(dropdown[1]).toMatch(/scrollbar-color:/);

    const bar = styles.match(
      /\.tags-filter-dropdown::-webkit-scrollbar\s*\{([^}]*)\}/,
    );
    expect(bar).not.toBeNull();
    expect(bar[1]).toMatch(/width:\s*8px/);

    const thumb = styles.match(
      /\.tags-filter-dropdown::-webkit-scrollbar-thumb\s*\{([^}]*)\}/,
    );
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/border-radius:\s*var\(--radius-pill\)/);
    expect(thumb[1]).toMatch(/background:\s*var\(--border-control\)/);
    expect(thumb[1]).toMatch(/background-clip:\s*padding-box/);
  });

  // A matched substring is marked in place: the row explains itself without
  // changing cell metrics.
  test("matched text is marked without moving the cell", () => {
    const mark = styles.match(/\.table-shell mark\s*\{([^}]*)\}/);
    expect(mark).not.toBeNull();
    expect(mark[1]).toMatch(/background:/);
    expect(mark[1]).not.toMatch(/padding:\s*0\s+\d+px\s+0\s+\d+px/);
  });

  // The column picker is portalled so the table's scroll containers cannot
  // clip it, exactly like the row actions menu.
  test("the column picker floats above the table in a portal", () => {
    const menu = styles.match(/\.table-columns-menu\s*\{([^}]*)\}/);
    expect(menu).not.toBeNull();
    expect(menu[1]).toMatch(/position:\s*fixed/);
    expect(menu[1]).toMatch(/z-index:\s*\d+/);
  });

  // The row action button is always visible: hiding it until hover made the
  // menu undiscoverable at rest. jsdom cannot resolve :hover, so the contract
  // is pinned here as a static check over the stylesheet.
  test("row actions stay visible without hover", () => {
    const base = styles.match(/\.row-menu-btn\s*\{([^}]*)\}/);
    expect(base).not.toBeNull();
    expect(base[1]).not.toMatch(/opacity:\s*0/);
    expect(styles).not.toMatch(/\.table-row-link:hover \.row-menu-btn/);
    expect(styles).toMatch(/\.row-menu-btn:hover,[^{]*\{[^}]*background:/);
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

  // The chip plan fills the column exactly, so the chips sit flush against
  // this box and a bare clip shaves their focus ring off. The list must reserve
  // the ring's reach (outline width plus offset) as padding and cancel it with
  // an equal negative margin so the chips keep their planned width.
  test("the tags list reserves room for the chip focus ring", () => {
    const ring = styles.match(/^:focus-visible\s*\{([^}]*)\}/m);
    const list = styles.match(/\.tag-list-clip\s*\{([^}]*)\}/);
    const cell = styles.match(/tbody td\s*\{([^}]*)\}/);
    expect(ring).not.toBeNull();
    expect(list).not.toBeNull();
    expect(cell).not.toBeNull();

    const outline = Number(ring[1].match(/outline:\s*(\d+)px/)?.[1]);
    const offset = Number(ring[1].match(/outline-offset:\s*(\d+)px/)?.[1]);
    const padding = Number(list[1].match(/padding:\s*(\d+)px/)?.[1]);
    const margin = Number(list[1].match(/margin:\s*-(\d+)px/)?.[1]);
    const cellPadding = Number(cell[1].match(/padding:\s*0\s+(\d+)px/)?.[1]);

    expect(padding).toBeGreaterThanOrEqual(outline + offset);
    // The negative margin cancels the padding, so no chip width is stolen.
    expect(margin).toBe(padding);
    // The ring still lands inside the cell, which is what clips the row.
    expect(cellPadding).toBeGreaterThanOrEqual(outline + offset);
    expect(list[1]).toMatch(/overflow:\s*hidden/);
  });

  test("the compact control columns use a few pixels of horizontal padding", () => {
    const order = styles.match(/\.table-order-cell\s*\{([^}]*)\}/);
    expect(order).not.toBeNull();
    expect(order[1]).toMatch(/padding-left:\s*4px/);
    expect(order[1]).toMatch(/padding-right:\s*4px/);

    const thumb = styles.match(/\.table-thumb-cell\s*\{([^}]*)\}/);
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/padding-left:\s*6px/);
    expect(thumb[1]).toMatch(/padding-right:\s*6px/);

    const actions = styles.match(/\.table-actions-cell\s*\{([^}]*)\}/);
    expect(actions).not.toBeNull();
    expect(actions[1]).toMatch(/padding-left:\s*4px/);
    expect(actions[1]).toMatch(/padding-right:\s*4px/);
    // The cell holds a single control, so it stays on one line instead of
    // wrapping into a taller row.
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

  test("the table header sits on the darker prototype surface", () => {
    const head = styles.match(/\.table-shell thead th\s*\{([^}]*)\}/);
    expect(head).not.toBeNull();
    expect(head[1]).toMatch(/background:\s*var\(--surface-3\)/);
    expect(head[1]).toMatch(/height:\s*40px/);
    expect(head[1]).toMatch(/padding:\s*0\s+12px/);
  });

  // The thumbnail bubble is absolutely positioned inside the pinned thumbnail
  // cell. A pinned cell is its own stacking context, so without lifting the
  // cell the bubble slips under the catalog number in the same row and under
  // the pinned cells of the rows below. The header must stay above it.
  // The bubble hangs off the pinned thumbnail cell, so it needs the cell's
  // stacking context lifted above the pinned cells of the rows below it.
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

  // The edge shadow marks the pinned block while it is panned; at rest the
  // permanent hairline on the last pinned cell is the only separator.
  test("the pan shadow only exists while the table is horizontally scrolled", () => {
    const rules =
      styles.match(/[^{}]*\.table-sticky-end::after[^{]*\{[^}]*\}/g) ?? [];
    // The resting hairline is one of these rules; the shadow must belong only
    // to the scrolled state.
    const shadowRules = rules.filter((rule) => /box-shadow:/.test(rule));
    expect(shadowRules).toHaveLength(1);
    expect(shadowRules[0]).toMatch(/\.table-scroll-x\.is-scrolled-x/);
  });

  test("only the last pinned cell carries a resting hairline", () => {
    const hairline = styles.match(
      /\.table-sticky-cell\.table-sticky-end::after\s*\{([^}]*)\}/,
    );
    expect(hairline).not.toBeNull();
    expect(hairline[1]).toMatch(/position:\s*absolute/);
    expect(hairline[1]).toMatch(/right:\s*0/);
    expect(hairline[1]).toMatch(/background:\s*var\(--border-soft\)/);
    // The control columns inside the pinned block (drag handle, selection,
    // display order, thumbnail) must not draw their own vertical border.
    expect(styles).not.toMatch(/\.table-sticky-cell::after/);
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

  // A drag begins with a press. Without this the press can start a text
  // selection across the row before the browser claims the gesture, which
  // paints a blue smear over the grip the user is holding.
  test("the handle never starts a text selection", () => {
    const base = styles.match(/^\.drag-handle\s*\{([^}]*)\}/m);
    expect(base).not.toBeNull();
    expect(base[1]).toMatch(/user-select:\s*none/);
    expect(base[1]).toMatch(/-webkit-user-select:\s*none/);
  });

  // The grab is the one direct-manipulation moment in the table, so it gets
  // its own mark: pressing the handle takes the grip to the accent instead of
  // leaving it on the resting tone.
  test("pressing the handle marks the grip", () => {
    const active = styles.match(/\.drag-handle:active\s*\{([^}]*)\}/);
    expect(active).not.toBeNull();
    expect(active[1]).toMatch(/cursor:\s*grabbing/);

    const dots = styles.match(/\.drag-handle:active \.drag-handle-dots\s*\{([^}]*)\}/);
    expect(dots).not.toBeNull();
    expect(dots[1]).toMatch(/color:\s*var\(--accent-strong\)/);
  });

  // The lift sets the row to a third opacity; without a transition the row
  // blinks out of the list instead of fading. The transition has to sit where
  // nothing later overrides it, which is why the collections table carries it
  // on the base row rule and the table row carries it on its dragging rule
  // (the plain row has no transition, so pruning a stripe stays instant).
  test("a lifted row fades rather than blinking", () => {
    const table = styles.match(/\.table-row-link--dragging\s*\{([^}]*)\}/);
    expect(table).not.toBeNull();
    expect(table[1]).toMatch(/opacity:\s*0\.38/);
    expect(table[1]).toMatch(/transition:\s*opacity 0\.12s ease/);

    const named = styles.match(/^\.named-record-row\s*\{([^}]*)\}/m);
    expect(named).not.toBeNull();
    expect(named[1]).toMatch(/opacity 0\.12s ease/);

    const namedDragging = styles.match(/\.named-record-row--dragging\s*\{([^}]*)\}/);
    expect(namedDragging).not.toBeNull();
    expect(namedDragging[1]).toMatch(/opacity:\s*0\.38/);
  });

  // The grip is the same control in both tables, so it is the same size in
  // both: one 24px column, expressed once per table and kept equal here.
  test("both tables give the reorder rail the same 24px column", () => {
    const table = styles.match(/\.drag-cell\s*\{([^}]*)\}/);
    expect(table).not.toBeNull();
    for (const property of ["width", "min-width", "max-width"]) {
      expect(table[1]).toMatch(new RegExp(`${property}:\\s*24px`));
    }

    const named = styles.match(/\.named-records-table td\.named-records-drag-cell\s*\{([^}]*)\}/);
    expect(named).not.toBeNull();
    for (const property of ["width", "min-width", "max-width"]) {
      expect(named[1]).toMatch(new RegExp(`${property}:\\s*24px`));
    }
    expect(named[1]).not.toMatch(/26px/);
  });

  // Decoration, not state: under a reduced-motion preference the grip's tone
  // and the dragged row's fade land in a single frame.
  test("the new table motion respects reduced-motion", () => {
    const reduce = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(reduce).not.toBeNull();
    for (const selector of [
      ".drag-handle",
      ".drag-handle-dots",
      ".table-row-link--dragging",
      ".named-record-row",
    ]) {
      expect(reduce[1]).toContain(selector);
    }
    expect(reduce[1]).toMatch(/transition:\s*none/);
  });

  // The insertion line is the row's edge, not a dash floating in the middle of
  // the handle: no side margin, so it starts where the row starts.
  test("the drop marker starts at the row edge", () => {
    const line = styles.match(/\.table-drop-placeholder-line\s*\{([^}]*)\}/);
    expect(line).not.toBeNull();
    expect(line[1]).toMatch(/margin:\s*0;/);
  });

  // The handle's opaque fill hides the drag cell's own inset shadow, so the
  // cell's share of the row ring has to be painted above the handle.
  test("the drag cell repaints the row ring above the handle", () => {
    const ring = styles.match(
      /\.table-row-link:focus-visible > td\.drag-cell::before,[^{]*\{([^}]*box-shadow[^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[0]).toMatch(/:has\(:focus-visible\)/);
    expect(ring[0]).toMatch(/\.table-row-link--active/);
    expect(ring[1]).toMatch(/inset 0 1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 0 -1px 0 var\(--accent\)/);
    expect(ring[1]).toMatch(/inset 1px 0 0 var\(--accent\)/);
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
    // The sort control hugs its label, so the column's alignment is carried by
    // the cell's text-align plus a compensating pull on the label's own edge.
    expect(styles).toMatch(
      /\.align-right \.sort-button\s*\{\s*margin-right:\s*-6px;\s*margin-left:\s*0/,
    );
  });

  // Columns flex with the viewport, so a wide window leaves a lot of air
  // between a short value and the next column. A hairline on every field
  // column keeps the grid legible; the drag handle shares the selection
  // cell's control group, and the pinned block draws its own end divider.
  test("hairlines divide every field column", () => {
    const rules = styles.match(
      /th:is\([\s\S]*?\)\s*,\s*td:is\([\s\S]*?\)\s*\{([^}]*)\}/,
    );
    expect(rules).not.toBeNull();
    for (const key of [
      "selection",
      "id",
      "thumbnail",
      "denomination",
      "issue_date",
      "grading_company",
      "grade",
      "serial",
    ]) {
      expect(rules[0]).toMatch(new RegExp(`\\.table-col-${key}\\b`));
    }
    // The drag handle is a control beside the checkbox, not a field.
    expect(rules[0]).not.toMatch(/\.table-col-reorder\b/);
    // Catalog number's right edge is the pinned block's own divider.
    expect(rules[0]).not.toMatch(/\.table-col-catalog_number/);
    // Tags is the last data column; the actions cell is a control, so no
    // hairline separates them.
    expect(rules[0]).not.toMatch(/\.table-col-tags\b/);
    expect(rules[1]).toMatch(/border-right:\s*1px solid var\(--border-soft\)/);
  });

  test("body rows are 45px at 13.5px text", () => {
    const bodyCells = styles.match(/tbody td\s*\{([^}]*)\}/);
    expect(bodyCells).not.toBeNull();
    expect(bodyCells[1]).toMatch(/height:\s*45px/);
    expect(bodyCells[1]).toMatch(/padding:\s*0\s+12px/);
    expect(bodyCells[1]).toMatch(/font-size:\s*13\.5px/);
  });

  test("the drop placeholder stays a thin gap, not a body row", () => {
    const placeholder = styles.match(
      /\.table-drop-placeholder-row td\s*\{([^}]*)\}/,
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder[1]).toMatch(/height:\s*auto/);
  });

  test("thumbnails are 56x32 with a hairline ring", () => {
    const thumb = styles.match(/\.table-thumb\s*\{([^}]*)\}/);
    expect(thumb).not.toBeNull();
    expect(thumb[1]).toMatch(/width:\s*56px/);
    expect(thumb[1]).toMatch(/height:\s*32px/);
    expect(thumb[1]).toMatch(/object-fit:\s*contain/);
    expect(thumb[1]).toMatch(/border-radius:\s*3px/);
    expect(thumb[1]).toMatch(/background:\s*#fff/);
    expect(thumb[1]).toMatch(/box-shadow:\s*0\s+0\s+0\s+1px\s+var\(--border-soft\)/);
    expect(styles).toMatch(
      /\.table-thumb-preview img\s*\{[^}]*width:\s*210px;[^}]*height:\s*118px/,
    );
  });

  test("catalog and denomination read as strong text, serial as a code", () => {
    expect(styles).toMatch(
      /td\.table-col-catalog_number\s*\{[^}]*font-weight:\s*600/,
    );
    expect(styles).toMatch(
      /td\.table-col-denomination a\s*\{[^}]*font-weight:\s*600;[^}]*text-decoration:\s*none/,
    );
    expect(styles).toMatch(
      /td\.table-col-denomination a:hover,[\s\S]*?text-decoration:\s*underline/,
    );
    // The serial is a code: a step under the body size, tracked, and muted,
    // so the long strings do not out-shout the note's name.
    expect(styles).toMatch(
      /td\.table-col-serial\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*500;[^}]*letter-spacing:\s*0\.045em;[^}]*color:\s*var\(--text-muted\)/,
    );
    // The row number is position, not content: one tone below the fields.
    expect(styles).toMatch(
      /td\.table-col-id\s*\{[^}]*color:\s*var\(--text-faint\)/,
    );
  });

  // The tags column and the filter field above the table keep one geometry —
  // radius, hairline weight and compact metrics — and now one family: a value
  // chip is Ochre whether it sits in a row or in the rail. Comparing the rules
  // keeps the shapes from drifting. The values are opaque so a row's hover or
  // selection tint never shows through a chip.
  test("table tags and filter chips keep one geometry and one family", () => {
    const filterChip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    const tag = styles.match(/\.table-tag\s*\{([^}]*)\}/);
    expect(filterChip).not.toBeNull();
    expect(tag).not.toBeNull();

    for (const prop of [
      /border:\s*1px solid var\(--tag-border\)/,
      /border-radius:\s*7px/,
      /background:\s*var\(--tag-bg\)/,
      /color:\s*var\(--tag-text\)/,
    ]) {
      expect(filterChip[1]).toMatch(prop);
      expect(tag[1]).toMatch(prop);
    }
    // No alpha in the tag ground: the row tint must not bleed through.
    expect(styles).toMatch(/--tag-bg:\s*#[0-9a-f]{6}/i);

    // The table tag is the whole chip: compact padding, no removable cross.
    expect(tag[1]).toMatch(/padding:\s*2px\s+8px/);
    expect(tag[1]).toMatch(/font-size:\s*0\.72rem/);
    expect(tag[1]).not.toMatch(/padding:\s*0\s+1px\s+0\s+0/);

    // The overflow affordance stays a dashed, muted ghost so it reads as a
    // control rather than a real tag.
    const more = styles.match(/\.table-tag\.table-tag--more\s*\{([^}]*)\}/);
    expect(more).not.toBeNull();
    expect(more[1]).toMatch(/border:\s*1px\s+dashed\s+var\(--tag-border-hover\)/);
    expect(more[1]).toMatch(/background:\s*transparent/);
    expect(more[1]).toMatch(/color:\s*var\(--tag-text-muted\)/);
  });

  // The chip is a value: its label and its cross carry the tag tones, while the
  // actions around it — the focus ring, the cross's hover, "Clear all" — stay
  // in the accent family.
  test("filter chip labels carry the tag tones", () => {
    const value = styles.match(/^\.table-filter-chip-value\s*\{([^}]*)\}/m);
    expect(value).not.toBeNull();
    expect(value[1]).toMatch(/color:\s*var\(--tag-text\)/);

    const input = styles.match(/^\.table-filter-chip-input\s*\{([^}]*)\}/m);
    expect(input).not.toBeNull();
    expect(input[1]).toMatch(/color:\s*var\(--tag-text\)/);

    const cross = styles.match(/^\.table-filter-chip-remove\s*\{([^}]*)\}/m);
    expect(cross).not.toBeNull();
    expect(cross[1]).toMatch(/color:\s*var\(--tag-text-muted\)/);

    // The negation repaints the value, and its rule has to come after the base.
    expect(styles.indexOf(".table-filter-chip--negated .table-filter-chip-value")).toBeGreaterThan(
      styles.indexOf(".table-filter-chip-value {"),
    );
  });

  test("the chevron appears on hover and marks the sorted direction", () => {
    const chevron = styles.match(/\.sort-chevron\s*\{([^}]*)\}/);
    expect(chevron).not.toBeNull();
    expect(chevron[1]).toMatch(/flex:\s*0\s+0\s+auto/);
    // Hidden at rest so every sortable header can carry one.
    expect(chevron[1]).toMatch(/opacity:\s*0/);
    expect(styles).toMatch(
      /\.sort-button:hover\s+\.sort-chevron\s*\{\s*opacity:\s*0\.45/,
    );
    expect(styles).toMatch(
      /\.sort-button--active\s+\.sort-chevron\s*\{\s*opacity:\s*1/,
    );
    expect(styles).toMatch(
      /th\[aria-sort="descending"\]\s+\.sort-chevron\s*\{[^}]*transform:\s*rotate\(180deg\)/,
    );
  });
});

describe("sidebar styles", () => {
  // The rail is the shell's one dark band. Its colours live in a named
  // token set so the treatment can be retoned in one place; the rules must
  // never hardcode a wash or a surface of their own.
  test("the rail reads its colours from the rail palette tokens", () => {
    expect(styles).toMatch(/--rail-bg:\s*#2c3a45/);
    const rail = styles.match(/\.sidebar\s*\{([^}]*)\}/);
    expect(rail).not.toBeNull();
    expect(rail[1]).toMatch(/background:\s*var\(--rail-bg\)/);
    expect(rail[1]).toMatch(/color:\s*var\(--rail-fg\)/);
    expect(rail[1]).toMatch(/border-right:\s*1px solid var\(--rail-line\)/);
    const link = styles.match(/\.sidebar-link\s*\{([^}]*)\}/);
    expect(link).not.toBeNull();
    expect(link[1]).toMatch(/color:\s*var\(--rail-muted\)/);
    expect(link[1]).not.toMatch(/rgba\(255/);
  });

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
  test("keeps the category marker visible on the quiet rail when collapsed", () => {
    const marker = styles.match(/\.sidebar-group-ic\s*\{([^}]*)\}/);
    expect(marker).not.toBeNull();
    expect(marker[1]).toMatch(/background:\s*var\(--rail-marker\)/);
    expect(marker[1]).toMatch(/color:\s*var\(--rail-muted\)/);
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
      /\.screen-stack\.showcase-screen > \.screen-body\s*\{([^}]*)\}/,
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

// The collection screen's head copies the prototype's page head: an 11px caps
// eyebrow over a 21px title, so the collection name reads as the page title
// rather than a panel heading.
describe("catalog header", () => {
  // The descendant selector is the point: a bare `.collection-eyebrow` ties
  // with the shared `.eyebrow` rule and loses the size, weight and tone to it.
  test("the Catalog eyebrow uses the caption size and the brand label voice", () => {
    const eyebrow = styles.match(
      /\.panel-heading-copy \.collection-eyebrow\s*\{([^}]*)\}/,
    );
    expect(eyebrow).not.toBeNull();
    expect(eyebrow[1]).toMatch(/font-size:\s*0\.6875rem/);
    expect(eyebrow[1]).toMatch(/font-weight:\s*800/);
    expect(eyebrow[1]).toMatch(/letter-spacing:\s*0\.09em/);
    expect(eyebrow[1]).toMatch(/text-transform:\s*uppercase/);
    expect(eyebrow[1]).toMatch(/color:\s*var\(--text-faint\)/);
  });

  test("the collection title wears the uppercase display voice at 21px", () => {
    const title = styles.match(/\.collection-title-row h1\s*\{([^}]*)\}/);
    expect(title).not.toBeNull();
    expect(title[1]).toMatch(/font-size:\s*1\.3125rem/);
    expect(title[1]).toMatch(/font-weight:\s*800/);
    expect(title[1]).toMatch(/letter-spacing:\s*-0\.01em/);
    expect(title[1]).toMatch(/text-transform:\s*uppercase/);
  });

  // Editing in place must not move the table: the form replaces the title in
  // the same grid cell, so it takes the title's 1.5 line box (21px × 1.5) and
  // the field fills it. The shared showcase field's 18px type and 8px of
  // vertical padding used to make the form taller than the heading.
  test("the inline rename form keeps the title's line box", () => {
    const form = styles.match(
      /\.panel-heading-copy \.collection-rename-form\s*\{([^}]*)\}/,
    );
    expect(form).not.toBeNull();
    expect(form[1]).toMatch(/height:\s*1\.5em/);
    expect(form[1]).toMatch(/font-size:\s*1\.3125rem/);

    const field = styles.match(
      /\.panel-heading-copy \.collection-rename-form \.showcase-name-field\s*\{([^}]*)\}/,
    );
    expect(field).not.toBeNull();
    expect(field[1]).toMatch(/height:\s*100%/);
    expect(field[1]).toMatch(/margin-left:\s*-5px/);
    expect(field[1]).toMatch(/padding:\s*0\s+4px/);
    expect(field[1]).toMatch(/font-size:\s*inherit/);
    expect(field[1]).toMatch(/font-weight:\s*800/);
    expect(field[1]).toMatch(/letter-spacing:\s*-0\.01em/);
  });

  // The rename control overhangs the content edge by 4px and every focus ring
  // is painted 3px outside the box. The screen clips at the content edge, so
  // the ring was cut off on the left. The screen and its wrappers hand that
  // band back instead, which keeps the layout where it was.
  test("the page head leaves room for the title's focus ring", () => {
    const clip = styles.match(
      /\.collection-screen,\s*\.collection-screen > \.screen-stack,\s*\.collection-screen \.screen-body\s*\{([^}]*)\}/,
    );
    expect(clip).not.toBeNull();
    expect(clip[1]).toMatch(/padding-inline:\s*8px/);
    expect(clip[1]).toMatch(/margin-inline:\s*-8px/);
  });
});
