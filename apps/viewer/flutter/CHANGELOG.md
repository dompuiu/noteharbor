# Changelog

All notable changes to the Note Harbor Viewer (Flutter app) are documented in this file.

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
