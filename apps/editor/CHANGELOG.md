# Changelog

All notable changes to the Note Harbor Editor (desktop, server, and web) are documented in this file.

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
