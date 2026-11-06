# Finding a note is a cursor over the table, not a filter

The Table screen has a transient find bar, opened by `Ctrl/Cmd+F` or the rail's `Find` button. It searches the notes already in the current filtered and sorted view across the visible searchable columns and moves a cursor through the matches. Opening it changes nothing else: filters, sort, selection, the URL and the saved table state stay exactly as they were, and rows are never hidden or unmounted.

The bar floats over the rows area rather than joining the rail, because the rail's width is already contended at narrow widths and opening find must not reflow the columns. `Enter` / `Shift+Enter` and `F3` / `Shift+F3` step the cursor with wrap-around; the counter reads notes, not occurrences (`2 of 7`). Every matched term is marked and the current match carries its own row tint and outline, centered with `rowVirtualizer.scrollToIndex(..., { align: "center" })` when it is outside the mounted window.

When filters are active and the current view has no match, the bar says `No matches in this view` and offers `Search all notes`, which clears the filters, keeps the query and jumps to the first match. With no filters the message is `No notes match` and there is no fallback, because there is no wider view to search. Closing with `Esc` clears the query and marks and hands focus to the current match's row; a second `Ctrl/Cmd+F` reopens empty, since find state is never persisted. Switching collections closes and clears find, and changing filters, sort or visible columns recomputes the matches; a current match that disappears falls back to the first one.

Find never intercepts `Ctrl/Cmd+F` while the Note editor, the slideshow, an Image popover, a dialog or menu owns focus. An empty query is idle, and one match keeps the previous/next controls disabled.

## Considered Options

- **Live filtering as you type.** Rejected: it destroys the surrounding rows, so the collector loses the context the search was meant to locate within, and it would have to overwrite the active filter chips.
- **Filter first, then walk the rows with `F3` only.** Rejected: it only works after a filter has narrowed the list and gives no way to reach a note in an unfiltered view.
- **A collection-wide go-to-note palette (`Ctrl/Cmd+K`).** Rejected for now: it reaches notes outside the current view but clears filters to do it, which is a navigation change rather than a cursor over what is on screen. It remains the natural next step if jumping across the collection becomes a frequent task.

## Consequences

- Find is a view cursor, not view state: the legend and footer summary announce `Find x of y` through the existing polite live region, and scrolling or stepping must not re-announce the count twice.
- The bar's query is deferred like the filter draft, and the match marks travel to the rows separately from their models, so a find keystroke does not remount the virtualizer or rebuild every visible row. A budget test guards that.
- Matching uses `matchesSearchQuery` over the visible data columns, so hidden columns are not searched, matching the All-fields filter. Searches that only a hidden column would satisfy need the column revealed first; extending find to hidden fields is out of scope.
- The current match is painted by `isFindCurrent` and its terms by `findMarks`, merged with the filter marks rather than replacing them. Focus stays in the find input while stepping, so `focusRowByNoteId` is used only for the close hand-off and never per match.
- `Escape` order is: close find, leave the filter field, drop the selection, drop the row cursor, clear the filters. The find input handles its own `Escape` and stops propagation so the window handler cannot close the bar twice.
- Find is not persisted and not written to the URL. Reopening starts empty; the last query is deliberately forgotten.
