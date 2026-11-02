# The table's filters are part of its card

The collection table's filter field, chips, column picker, `Reset view` and `Add note` sit in a `.table-rail` inside `.table-shell`, above the scrollport and outside `.table-scroll-x`, rather than in a toolbar band above the card. This reverses the rule in `styles.css` that "only the table itself is a surface": the surface now includes the table's own chrome, because these controls describe nothing but the table. The card's top edge rises to ~14px under the page head, and the old 30px hint row disappears.

`Add note` later moved from the page head into the head of the rail's trailing cluster. The page head keeps only the title and the collection menu; creation now sits with the table it affects.

## Considered Options

- **Merge the filter field into the table header.** Rejected: the field would share the header's width budget and pan horizontally with the columns, so it would scroll away from the rows it filters.
- **Keep the chips row above the card and collapse overflow into a `+N` menu.** Rejected: the rail already wraps, and a popover would hide the active filters behind another click before there are enough filters to need it.
- **Move `Add note` into a table toolbar.** Initially rejected to leave the page-head convention alone. Adopted later: the head's hover shortcut badge was clipped by the screen's top edge, and the create action reads as table chrome. The button leads the rail's trailing cluster, so it is reached before `Reset view` and `Columns` while `Columns` keeps the card's right edge.

## Consequences

- The card keeps its `flex: 1 1 auto` height, so the rail's 48px (plus ~32px per wrapped chip line) comes out of the rows region.
- `.table-shell` now holds more than the table: the focus anchor, the rail, the scrollport and the floating bulk bar. The footer hint stays outside it, below the card.
- The rail is ordinary flow content: no sticky positioning and no scroll listeners, because being a sibling of the scroller is enough to keep it visible and still while columns pan.
- Drag autoscroll measures the scrollport's top edge rather than the shell's, so dragging across the rail does not scroll the rows.
- `Add note` leads the trailing cluster, then `Reset view` sits to the left of `Columns` and no slot reserves its width. The group grows leftwards, so `Columns` keeps the card's right edge and a default view shows no empty gutter where a control might appear.
- `Add note` uses the shared `data-shortcut` hover badge, but it opens downward. The rail is inside the shell's `overflow: hidden`, so the default badge above the button would be cropped.
- The OR/AND rule is prose in the rail while the rail has no chips, in the chips' own slot; the first chip replaces it. T66 superseded the earlier `?` popover, which sat at the rail's far edge and still claimed "No filters yet" over active filters.
- The rail is part of the table's keyboard contract, not a separate key scope. `isScreenChromeTarget` treats focus inside `.table-rail` as table chrome, so Escape on `Add note`, `Columns`, `Reset view`, a chip or the filter field still clears the selection or filters, and the arrow keys still walk the rows. This preserves the behaviour those controls had in the toolbar band above the card.
