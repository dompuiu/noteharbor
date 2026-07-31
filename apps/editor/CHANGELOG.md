# Changelog

All notable changes to the Note Harbor Editor (desktop, server, and web) are documented in this file.

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
