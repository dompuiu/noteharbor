# Changelog

All notable changes to the Note Harbor Editor (desktop, server, and web) are documented in this file.

## [1.7.0] - 2026-09-12

### Added

- Added one shared tags field for the Table screen filter and the Note editor: chips with an inline input, a suggestion list anchored under the field, arrow-key navigation with `Enter` to pick, comma to commit, `Backspace` on empty input to remove the last tag, and duplicate/limit hints instead of silent ignores.
- Added a separate suggestion list under the Tags field in the Note editor; picking a suggestion adds it through the same path as typing.
- The Table screen now stays responsive while filters change: inputs, chips, and counts update instantly and the rows follow a beat later.

### Changed

- The tags filter field now looks like the other filter fields: `--surface` background with the accent focus ring instead of hardcoded white with no focus treatment.
- `Tab` in the tags field moves focus to the next element instead of committing the typed text.
- The Clear all control in the tags field is pill-shaped, so its focus ring matches the chips beside it.
- Row thumbnails now lazy-load with async decoding and the hover preview loads on demand, halving the image requests on filter changes.
- Non-ID sorts reuse one cached collator and selection checks use `Set` lookups, keeping filter and sort commits fast as collections grow.
- The Import screen hides the "Collections to export" section when the database has no collections.

### Fixed

- Fixed the tags suggestion list rendering underneath the edit overlay where it could not be seen; it now paints above the overlay while staying below the modal dialogs.

## [1.6.3] - 2026-09-11

### Changed

- Simplified the Note editor's tags field by removing the native suggestion dropdown; tags are now added from the suggestion cloud via `Enter` or Add.

## [1.6.2] - 2026-09-10

### Changed

- Removed the focus highlight border on the Table screen's tags filter field; other filter fields keep their highlight.
- The tags filter suggestions now match anywhere in the tag name instead of prefix-only, with tags starting with the typed text ranked above tags containing it elsewhere (e.g. typing `digits` suggests `2 digits` and `3 digits`).

## [1.6.1] - 2026-09-07

### Fixed

- Fixed the Table screen's sort headers wrapping the sort arrow underneath the column label in narrow columns (most visible on the ID header in the desktop app): the label and arrow now stay on one line and the column widens to fit them instead.

## [1.6.0] - 2026-09-07

### Added

- Changing a Table screen filter or sort order now resets keyboard row focus, so the next `↓` starts at the first row of the new order instead of continuing from the previously focused row's position.

### Changed

- Reworked the Editor web theme into a warm professional palette: flat warm surfaces, a single honey-bronze accent, system sans throughout, unified buttons, inputs, tags, and badges, and a CSS token system (`--bg`, `--surface`, `--accent`, `--scroll-*`, `--on-dark-*`) so future palette tweaks are one-line changes.
- Brought the Note slideshow and Image popover into the same warm theme: warm espresso surfaces, honey accent hovers and links, unified corner radii, and flat border-highlight hovers on image buttons instead of the lift effect.
- Import/Export collection checkboxes are now smaller (13px) to match the label text; Table screen and Note editor checkboxes stay larger for touch use.
- Removed the arrow-key shortcut hints from the slideshow and Image popover navigation buttons.

### Fixed

- Fixed the Table screen's horizontal scrollbar showing the old bronze on hover: the vertical and horizontal bars now share the `--scroll-*` tokens so both stay in sync.

## [1.5.1] - 2026-09-07

### Fixed

- Restored the Table screen's adaptive columns after the scrollbar change: columns again shrink and stretch with the window width instead of staying fixed-width, and the bottom scrollbar only appears once the table reaches its minimum width.
- Fixed the Table screen's bottom scrollbar flickering on and off while resizing the window near the point where it hides.

## [1.5.0] - 2026-09-07

### Added

- Added a visible vertical scrollbar to the Table screen that runs alongside the rows only, below the sticky header. It can be dragged, paged by clicking the track, and operated from the keyboard, and it stays in sync with the virtualized rows.
- Added `PgUp`/`PgDn` keyboard scrolling for the Table screen: they move by one page and focus the top visible row, so a following `↑`/`↓` continues from what's on screen. Both keys are listed in the `?` shortcuts help.
- Added `Home`/`End` keyboard navigation for the Table screen: they focus the first and last rows respectively, from anywhere on the screen except while typing in a filter field. Both keys are listed in the `?` shortcuts help.

### Changed

- Table rows now stop before the scrollbar instead of sliding underneath it: the header carries a gutter column over the bar while body content ends at the last content cell, and the row hover tint and focus ring are painted on the cells so the focused row's rectangle stays fully visible.
- The table scrollbar is now opaque (same hues as before), always shows its track, and sits flush against the shell border.

### Fixed

- Fixed keyboard focus landing on rows hidden underneath the sticky header: moving focus with `↑`/`↓`, `Home`/`End`, or paging now scrolls the focused row fully into view below the header.
- Fixed `PgUp`/`PgDn` on the scrollbar thumb paging twice (once from the thumb, once from the table's global handler).
- Replaced the browser's default full-row focus outline with the cell-painted focus ring so no extra rectangle spans the scrollbar gutter.

## [1.4.1] - 2026-08-29

### Fixed

- Zoom view in the Image popover now fills the responsive space available between its controls instead of inheriting the fitted Note image's dimensions. The point clicked or scrolled over remains visible when entering Zoom view, and resizing the window keeps the pannable area in sync.

## [1.4.0] - 2026-08-21

### Added

- Added a native desktop right-click menu for Note editor text fields in the Electron app, with Cut, Copy, Paste, and Select All actions.

## [1.3.0] - 2026-08-21

### Added

- Added Zoom view to the Note slideshow's Image popover in the Editor app: double-click or press `+` to enter natural-size viewing, use further `+`/`-` steps or the mouse wheel to zoom up to 400%, drag or use `Shift` + arrow keys to pan, and press `Esc` once to return to fit view before closing.

## [1.2.0] - 2026-08-01

### Added

- Added a chip-based, autocompleting tags filter: type to see matching tag suggestions, pick one with the mouse or `↑`/`↓` + `Enter`, remove the last chip with `Backspace`, and clear every selected tag at once with the new "Clear all" button. The filter row grows to fit the chips instead of clipping them.
- Clicking a tag on a note row now adds it to the current tag filter instead of replacing it, so you can click several tags in a row to narrow down results; Shift+click still replaces the filter with just that tag.
- Tags are now shown as a single-line, fixed-width list per row with a "+N" indicator when they don't all fit. Hovering or focusing "+N" opens a popover listing the rest, which stays on screen (flipping above the row when there isn't room below) and lets you click a tag to filter by it.
- Added row-level keyboard shortcuts for the focused table row: `e` opens it for editing, `d` deletes it, `c` copies its details, and `a` inserts a new note before it. They only fire while a row genuinely has keyboard focus, not just the last one you had focused.
- Added an invisible focus target just above the table: pressing `Esc` from a focused row, a filter field, or the header's "select all" checkbox now lands there, and pressing `↓` from that point enters the table at the first row (previously `Tab` order and `Esc` behavior were less predictable here).
- Pressing `Enter` while typing a tag on the note edit form now adds the highlighted suggestion directly, instead of requiring a click on "Add".

### Changed

- Tag filtering (both the tags column filter and clicking a tag chip) now matches by prefix instead of requiring an exact match, e.g. "trav" matches "travel".
- Removed the hover tooltip that showed the `/` shortcut hint on the denomination column filter; it was distracting.
- Filter input text is now centered instead of left-aligned.

### Fixed

- Filtering the "Scraped" column now matches the status actually shown on screen (e.g. "running"/"queued" while a scrape job is active) instead of only the note's underlying stored status.
- Pressing `Esc` in the tags filter no longer requires a second press to leave the filters and return to the table when no suggestions are showing.

## [1.1.1] - 2026-07-31

### Added

- Added macOS support for launching the scrape browser (Chrome), which was previously limited to Windows. The desktop app now looks for Google Chrome under `/Applications` and `~/Applications`, in addition to honoring the `NOTE_HARBOR_CHROME_PATH` override.

## [1.1.0] - 2026-07-31

### Added

- Added keyboard navigation across the notes table and slideshow: `/` focuses the first filter field, `↑`/`↓` (or `j`/`k`) move focus between rows, and `Enter`/`↓` opens the image preview from the slideshow. `Esc` steps back up one level at a time (filter → table, preview → slideshow, slideshow → table), restoring focus to the row you came from.
- Added a `?` keyboard-shortcuts help overlay, plus a "Shortcuts" button in the table toolbar and instant hover/focus tooltips on the relevant buttons, so the new shortcuts are discoverable without memorizing them.
- Added an option to move notes to a different collection from the note edit form.

## [1.0.1] - 2026-07-31

### Fixed

- Fixed the notes table header rendering: the divider between the column-title row and the filter-input row was semi-transparent, and scrolled note rows could bleed through the 1px seam at the bottom of the sticky header. Switched the table to `border-collapse: separate`, gave header cells an opaque background, and scoped the white divider to the title row only.

### Added

- Added a favicon to the web app, generated from the desktop app's icon so the browser tab matches the desktop app icon.

## [1.0.0] - 2026-07-31

### Added

- Initial release. Aligned `editor_server` and `editor_web` versions with `editor_desktop` at 1.0.0, and surfaced the app version in the macOS About panel via `app.getVersion()`.
