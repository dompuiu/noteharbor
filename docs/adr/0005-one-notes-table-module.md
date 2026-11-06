# One notes table implementation behind two destinations

The Table screen and the All notes screen remain separate destinations with
their own routes, sidebar entries, data sources and state stores. Behind them
they share one notes table module: `useNotesTable` owns the controller (find,
keyboard map, column geometry, virtualization, row focus, toolbar and footer)
and `NotesTableView` owns the chrome over `TableSurface`. Each screen is a thin
adapter that supplies rows, a column model, a capability object and callbacks.

The variation between the screens is expressed as capabilities, not as a second
implementation: `canEdit`, `canCreate`, `canDelete`, `canReorder`, `canSelect`
and `canMove`. A missing capability means the corresponding column, handler and
shortcut do not exist; no no-op handlers are fabricated. Column *structure*
still comes from the screen (`tableColumns` vs `allNotesColumns`) because All
notes adds a sticky Collection column and has no identity block.

What stays outside the module is what genuinely differs: `getNotes` versus
`getAllNotes`, localStorage versus URL persistence, the collection chrome, and
the slideshow route. View state (scope → filter → sort) is a pure composition
shared by both screens; the screens keep their own stores.

## Considered Options

- **Keep two tables and share only presentation.** Rejected: `TableSurface`
  already is that seam, and the controller above it was copied. The copies had
  already drifted — All notes dropped the filter hand-off, Escape-resume and
  the richer focus rules.
- **One component with a `readOnly` boolean.** Rejected: six independent
  differences would hide behind one flag, and read-only would still branch
  inside the component instead of removing capability.
- **Move data fetching and persistence into the module.** Rejected: it would
  make the table module depend on routing and on which store a screen uses,
  growing the interface for no gain. The two data sources are the real adapters
  that justify the seam.

## Consequences

- `AllNotesTable.jsx` shrinks to the All notes screen's adapter over the shared
  view; it no longer owns a table implementation. The All notes screen keeps
  its route, sidebar entry, collection picker and `aria-label`.
- `NotesTable` remains the public entry, so the existing Table-screen test suite
  stays the behavioural contract.
- The module owns the table's keyboard map, so a shortcut added once reaches
  both screens; capabilities decide whether it is active.
- The slideshow hand-off remains screen-specific; the module receives only
  `slideshowActive` to restore the row cursor.
- `TableSurface` stays the internal presentation seam and is not narrowed by
  this decision.
