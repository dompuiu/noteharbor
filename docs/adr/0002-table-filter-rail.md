# The table's filters are part of its card

The collection table's filter field, chips, column picker and `Reset view` sit in a `.table-rail` inside `.table-shell`, above the scrollport and outside `.table-scroll-x`, rather than in a toolbar band above the card. This reverses the rule in `styles.css` that "only the table itself is a surface": the surface now includes the table's own chrome, because these controls describe nothing but the table. The card's top edge rises to ~14px under the page head, so `Add note` docks to the table without moving, and the old 30px hint row disappears.

## Considered Options

- **Merge the filter field into the table header.** Rejected: the field would share the header's width budget and pan horizontally with the columns, so it would scroll away from the rows it filters.
- **Keep the chips row above the card and collapse overflow into a `+N` menu.** Rejected: the rail already wraps, and a popover would hide the active filters behind another click before there are enough filters to need it.
- **Move `Add note` into a table toolbar.** Rejected: it changes the page-head convention to fix a distance problem, while moving the card up solves the distance and leaves the head alone.

## Consequences

- The card keeps its `flex: 1 1 auto` height, so the rail's 48px (plus ~28px per wrapped chip line) comes out of the rows region.
- `.table-shell` is now a three-part surface: the rail, the scrollport below it, and the bulk bar floating over the rows.
- The rail is ordinary flow content: no sticky positioning and no scroll listeners, because being a sibling of the scroller is enough to keep it visible and still while columns pan.
- Drag autoscroll measures the scrollport's top edge rather than the shell's, so dragging across the rail does not scroll the rows.
