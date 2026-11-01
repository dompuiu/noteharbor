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

  // Selected rows sit a shade darker than the hover wash (0.14 against 0.12),
  // matching the prototype. The accent edge and the checkbox still carry the
  // selection state.
  test("the selected row tint is darker than the hover tint", () => {
    expect(styles).toMatch(
      /--row-selected:\s*rgba\(150,\s*98,\s*47,\s*0\.14\)/,
    );
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
      /background:\s*rgba\(150,\s*98,\s*47,\s*0\.28\)/,
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

  // The toolbar search keeps the prototype's taller 40px bar; the column
  // filters below stay on their own 36px band.
  test("column filters match the search field's height", () => {
    const search = styles.match(/^\.table-search-input\s*\{([^}]*)\}/m);
    expect(search).not.toBeNull();
    expect(search[1]).toMatch(/height:\s*36px/);

    // The scoped field matches the prototype's 40px bar.
    const scoped = styles.match(/\.table-search--scoped\s*\{([^}]*)\}/);
    expect(scoped).not.toBeNull();
    expect(scoped[1]).toMatch(/height:\s*40px/);

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

  // The idle hint under the field and the input placeholder share the
  // prototype's lighter tone and 12px scale.
  test("the filter bar hint matches the prototype's tone", () => {
    const hint = styles.match(/\.table-filter-chips-empty\s*\{([^}]*)\}/);
    expect(hint).not.toBeNull();
    expect(hint[1]).toMatch(/color:\s*var\(--text-hint\)/);
    expect(hint[1]).toMatch(/font-size:\s*0\.75rem/);

    const placeholder = styles.match(
      /\.table-search--scoped \.table-search-input::placeholder\s*\{([^}]*)\}/,
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder[1]).toMatch(/color:\s*var\(--text-hint\)/);
  });

  // The chip row closes the toolbar: it keeps its own line under the controls
  // while sitting before them in the DOM, so Tab reaches the chips first. The
  // row hands its bottom margin to the chips so the table does not move.
  test("the chip row keeps its own line under the controls", () => {
    const row = styles.match(/\.toolbar-row--table-controls\s*\{([^}]*)\}/);
    expect(row).not.toBeNull();
    expect(row[1]).toMatch(/row-gap:\s*10px/);
    expect(row[1]).toMatch(/margin-bottom:\s*0/);

    const chips = styles.match(
      /\.toolbar-row--table-controls\s*>\s*\.table-filter-chips\s*\{([^}]*)\}/,
    );
    expect(chips).not.toBeNull();
    expect(chips[1]).toMatch(/order:\s*1/);
    expect(chips[1]).toMatch(/flex:\s*1 0 100%/);
    expect(chips[1]).toMatch(/min-width:\s*0/);
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

  // The chip is what the user acts on, so keyboard focus rings all of it
  // rather than the small cross inside it.
  test("keyboard focus rings the whole tag chip", () => {
    const ring = styles.match(
      /\.tags-filter-chip:has\(\.table-filter-chip-remove:focus-visible\)\s*\{([^}]*)\}/,
    );
    expect(ring).not.toBeNull();
    expect(ring[1]).toMatch(/border-color:\s*var\(--accent\)/);
    expect(ring[1]).toMatch(/outline:\s*2px solid var\(--accent-soft\)/);

    const cross = styles.match(
      /\.tags-filter-chip \.table-filter-chip-remove:is\(:focus-visible\)\s*\{([^}]*)\}/,
    );
    expect(cross).not.toBeNull();
    expect(cross[1]).toMatch(/outline:\s*none/);
  });

  // Suggestions below the editor's tags field are the same chip as the ones
  // above it: the button carries `.table-filter-chip` for the surface, and
  // this rule only adds the padding the chip's inner value would supply.
  test("tag suggestions use the filter chip surface", () => {
    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/height:\s*24px/);
    expect(chip[1]).toMatch(/border-radius:\s*7px/);
    expect(chip[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--accent-strong\)/);

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
    expect(head[1]).toMatch(/font-weight:\s*650/);
    expect(head[1]).toMatch(/font-size:\s*0\.625rem/);
    expect(head[1]).toMatch(/letter-spacing:\s*0\.075em/);
    expect(head[1]).toMatch(/text-transform:\s*uppercase/);
    expect(head[1]).toMatch(/color:\s*#8a755a/);
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

  // Filter chips stay legible at rest: the field label reads as a label, the
  // value chip carries the accent wash, and a negation stays in the danger
  // family. No new palette.
  test("filter chips stay in the accent family", () => {
    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--accent-strong\)/);

    const label = styles.match(/\.table-filter-facet-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/color:\s*var\(--text-muted\)/);

    const negated = styles.match(/\.table-filter-chip--negated\s*\{([^}]*)\}/);
    expect(negated).not.toBeNull();
    expect(negated[1]).toMatch(/var\(--danger\)/);
  });

  // The chip row follows the prototype's metrics: a 28px facet, a 24px value
  // chip, 12px labels and a 9px "and" separator.
  test("filter chips match the prototype's metrics", () => {
    const facet = styles.match(/\.table-filter-facet\s*\{([^}]*)\}/);
    expect(facet).not.toBeNull();
    expect(facet[1]).toMatch(/height:\s*28px/);
    expect(facet[1]).toMatch(/padding:\s*0\s+4px\s+0\s+2px/);

    const chip = styles.match(/\.table-filter-chip\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/height:\s*24px/);

    const label = styles.match(/\.table-filter-facet-label\s*\{([^}]*)\}/);
    expect(label).not.toBeNull();
    expect(label[1]).toMatch(/font-size:\s*0\.75rem/);
    expect(label[1]).toMatch(/font-weight:\s*650/);

    const and = styles.match(/\.table-filter-and\s*\{([^}]*)\}/);
    expect(and).not.toBeNull();
    expect(and[1]).toMatch(/font-size:\s*0\.5625rem/);
    expect(and[1]).toMatch(/padding:\s*0\s+6px/);

    const clear = styles.match(/\.table-filter-clear-all\s*\{([^}]*)\}/);
    expect(clear).not.toBeNull();
    expect(clear[1]).toMatch(/color:\s*var\(--accent\)/);
    expect(clear[1]).toMatch(/margin-left:\s*6px/);

    // The remove cross is drawn, not typed, so it centres in its 17px hit box.
    const cross = styles.match(/\.table-filter-chip-remove svg\s*\{([^}]*)\}/);
    expect(cross).not.toBeNull();
    expect(cross[1]).toMatch(/display:\s*block/);
    expect(cross[1]).toMatch(/width:\s*8px/);
  });

  // Tabbing to a chip's remove cross should light it up exactly like a mouse
  // hover: same red fill, with a ring so the focused target is still clear.
  test("keyboard focus on a chip cross matches its hover state", () => {
    const fill = styles.match(
      /\.table-filter-chip-remove:hover,\s*\.table-filter-chip-remove:focus-visible\s*\{([^}]*)\}/,
    );
    expect(fill).not.toBeNull();
    expect(fill[1]).toMatch(/background:\s*var\(--danger\)/);
    expect(fill[1]).toMatch(/color:\s*var\(--accent-ink\)/);

    const ring = styles.match(
      /\.table-filter-chip-remove:focus-visible\s*\{\s*outline:\s*1px solid var\(--danger\)/,
    );
    expect(ring).not.toBeNull();
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

  test("body rows are 46px at 13.5px text", () => {
    const bodyCells = styles.match(/tbody td\s*\{([^}]*)\}/);
    expect(bodyCells).not.toBeNull();
    expect(bodyCells[1]).toMatch(/height:\s*46px/);
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

  test("catalog and denomination read as strong text, serial gets tracking", () => {
    expect(styles).toMatch(
      /td\.table-col-catalog_number\s*\{[^}]*font-weight:\s*600/,
    );
    expect(styles).toMatch(
      /td\.table-col-denomination a\s*\{[^}]*font-weight:\s*600;[^}]*text-decoration:\s*none/,
    );
    expect(styles).toMatch(
      /td\.table-col-denomination a:hover,[\s\S]*?text-decoration:\s*underline/,
    );
    expect(styles).toMatch(
      /td\.table-col-serial\s*\{[^}]*letter-spacing:\s*0\.03em;[^}]*color:\s*#4a3a28/,
    );
    expect(styles).toMatch(
      /td\.table-col-id\s*\{[^}]*color:\s*var\(--text-muted\)/,
    );
  });

  test("table tags follow the prototype's compact tinted pill", () => {
    const chip = styles.match(/\.table-tag\s*\{([^}]*)\}/);
    expect(chip).not.toBeNull();
    expect(chip[1]).toMatch(/padding:\s*2px\s+8px/);
    expect(chip[1]).toMatch(/border:\s*0/);
    expect(chip[1]).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(chip[1]).toMatch(/color:\s*var\(--accent-strong\)/);
    expect(chip[1]).toMatch(/font-size:\s*0\.72rem/);

    const more = styles.match(/\.table-tag\.table-tag--more\s*\{([^}]*)\}/);
    expect(more).not.toBeNull();
    expect(more[1]).toMatch(/border:\s*1px\s+dashed\s+var\(--border-control\)/);
    expect(more[1]).toMatch(/background:\s*transparent/);
    expect(more[1]).toMatch(/color:\s*var\(--text-muted\)/);
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

// The collection screen's head copies the prototype's page head: a 10px caps
// eyebrow over a 21px title, so the collection name reads as the page title
// rather than a panel heading.
describe("catalog header", () => {
  // The descendant selector is the point: a bare `.collection-eyebrow` ties
  // with the shared `.eyebrow` rule and loses the size, weight and tone to it.
  test("the Catalog eyebrow uses the prototype's caption size and tone", () => {
    const eyebrow = styles.match(
      /\.panel-heading-copy \.collection-eyebrow\s*\{([^}]*)\}/,
    );
    expect(eyebrow).not.toBeNull();
    expect(eyebrow[1]).toMatch(/font-size:\s*0\.625rem/);
    expect(eyebrow[1]).toMatch(/font-weight:\s*600/);
    expect(eyebrow[1]).toMatch(/letter-spacing:\s*0\.09em/);
    expect(eyebrow[1]).toMatch(/text-transform:\s*uppercase/);
    expect(eyebrow[1]).toMatch(/color:\s*var\(--text-hint\)/);
  });

  test("the collection title sits at the prototype's 21px", () => {
    const title = styles.match(/\.collection-title-row h1\s*\{([^}]*)\}/);
    expect(title).not.toBeNull();
    expect(title[1]).toMatch(/font-size:\s*1\.3125rem/);
    expect(title[1]).toMatch(/font-weight:\s*650/);
    expect(title[1]).toMatch(/letter-spacing:\s*-0\.01em/);
  });
});
