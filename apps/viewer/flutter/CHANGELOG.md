# Changelog

All notable changes to the Note Harbor Viewer (Flutter app) are documented in this file.

## [Unreleased]

### Added

- Table screen: keyboard row selection on desktop (Windows/macOS/Linux/Web), matching the Editor's table shortcuts — `↑`/`↓` (plus `j`/`k`), `Home`/`End`, `PgUp`/`PgDn` with pin-to-top paging, `Enter`/`Space` to open the selected note, `/` to focus the filter field (dropping the row selection), and `Esc` to leave it. The selected row shows a paint-only accent ring that never shifts row layout. Keys stay inert on iOS/Android, where tap behavior is unchanged.
- Note slideshow: open the image popover from the keyboard with `Enter`, `Space`, or `↓` (front image preferred, back as fallback; no-op when the note has no images). Keys are ignored while a control such as the Back button has focus.

## [1.0.5] - 2026-09-07

### Fixed

- Table screen: switch the table header background to Subtle Plus (`#E6D9BE`) so the card-top edge stays visible against the page background on iPhone, and strengthen the divider below the header to 2px `borderControl` (`#D4C6B4`).

## [1.0.4] - 2026-09-07

### Fixed

- Table screen: soften the table header background to reuse `surfaceContainer` (`#EFE5D2`) for a more polished, lower-contrast separation from the table rows while keeping header text highly legible.

## [1.0.3] - 2026-09-07

### Fixed

- Table screen: give the table header its own darker warm taupe band (`ViewerPalette.tableHeaderBackground`) so it stands apart from the screen background and table rows, and strengthen the divider below the header. Tag chips and thumbnail placeholders keep the previous tone.

## [1.0.2] - 2026-09-07

### Fixed

- Archive import: show a blocking progress popup with a spinner, the `Importing archive...` message, and the archive name while an import runs. Back navigation is blocked until the import finishes.
- Archive import: run the whole import (extraction, staging copy, database merge) in a background isolate, so importing large archives no longer freezes the interface.
- Archive import: parse the dataset in chunks after importing, keeping the progress popup animated until the new data is ready.

## [1.0.1] - 2026-09-06

### Fixed

- Archive import: fix build break after upgrading `file_picker` to 12.x, whose `pickFiles` API returns the file list directly instead of a `FilePickerResult`.

## [1.0.0] - 2026-09-07

### Added

- Initial release: read-only native viewer for archives exported from the Editor, working without the Node server at runtime.
- Archive import: pick a `.zip` archive with `banknotes.db` and `images/` to install notes, pictures, and database on the device. Switch collections, set a default collection, and delete a collection or all imported data from the Import screen.
- Notes table: field-scoped search (`denomination:`, `catalog:`, `tag:`, …), sortable columns, tag chips, and thumbnails.
- Note slideshow: browse notes one at a time with images, metadata, tags, and scraped catalog details.
- Image lightbox: full-size image sequence across the collection with pinch and double-tap zoom, swipe navigation, and per-image counters.
- Warm professional theme shared through a central `ViewerPalette`, with danger-styled delete actions.
