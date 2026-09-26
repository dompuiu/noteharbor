# Changelog

All notable changes to the Note Harbor Viewer (Flutter app) are documented in this file.

## [1.6.0] - 2026-09-26

### Added

- Import screen: the archive picker is a dashed drop zone showing the selected file name, a readiness hint, and a ZIP badge. Import and delete results appear in a status banner with a success/error icon and accent edge.
- Table screen: loading shows a skeleton placeholder, and an empty filter result shows an illustrated empty state with a clear-the-filter hint.
- Table screen: `Tab`/`Shift`+`Tab` follow an explicit order — filter field, sortable column headers, rows — with `Shift`+`Tab` from the filter reaching the Import button. Tabbing into rows resets panned columns to the left edge, and focused headers scroll into view.
- Note slideshow: hover-revealed edge chevrons over the slide edges move to the previous/next note on desktop; they stay invisible and inert on touch devices.

### Changed

- App theme: the interface typeface is Inter (bundled) with a unified Material 3 theme for buttons, inputs, dialogs, tooltips, and scrollbars. Switching between the Import and Table screens crossfades (instant when reduced motion is requested).
- Table screen: the header is reduced to the app icon plus the `Note Harbor` title; column headers are uppercase with an animated sort indicator, and odd rows carry a zebra tint.
- Note slideshow and image viewer: navigation stops at the first/last item instead of wrapping around.
- Note slideshow: `↑`/`↓` scroll the slide content instead of opening the image viewer; the viewer opens with `Enter`/`Space`.
- Note slideshow: slide images sit in a fixed 3:2 recessed dark well with no hairline border, so framing no longer depends on the picture's size.
- Table screen: scrolling with the mouse wheel or a drag drops the keyboard row selection and collapses a lingering select-all highlight in the filter field; keyboard-driven scrolling is unaffected.

### Fixed

- Table screen and Import screen: arrow keys keep working after switching between the two screens, instead of focus being lost with the unmounted screen during the transition.
- Note slideshow: the index pill and Back button heights are aligned, a bottom fade signals scrollable content, and no scrollbar is shown.

## [1.5.1] - 2026-09-24

### Fixed

- Table screen: pressing `↑` (or `k`) with no row selected now selects the first row, matching the Editor, instead of jumping to the last row.
- Table screen: dragging a row with the mouse no longer drops keyboard focus. If the filter had focus, a drag (which never fires a tap) left primary focus on the route scope, so `/` stopped reaching the filter and `↓` moved to the Import button instead. Pointer interactions now hand keyboard control back to the table.
- Table screen: grabbing or dragging a row with the mouse now clears the keyboard selection ring, which is a keyboard-only affordance.

## [1.5.0] - 2026-09-24

### Added

- Import screen: `Esc` returns to the table screen. Confirmation dialogs still handle their own `Esc` first, and leaving stays blocked while an import is running.

### Fixed

- Table screen: the table keeps the normal cursor on hover and only shows a drag hand while panning the columns (both the rows and the header). Windows ships no closed-hand cursor, so it falls back to the pointing hand there; other platforms use the closed hand.
- Table screen: opening a note by clicking a row no longer leaves the keyboard selection ring behind. The ring is a keyboard affordance and now returns only when the slideshow was opened with the keyboard.

## [1.4.0] - 2026-09-24

### Added

- Table screen: reach columns that sit off-screen on a narrow window. Drag any row (or the header) with the mouse — rows show a grab cursor that becomes a closed hand while dragging. `←`/`→` scroll a step through the columns, and `Ctrl`+`←`/`→` (`Cmd` on macOS) jump to the first/last column. No horizontal scrollbar is added; `Shift`+wheel and trackpad panning are unchanged.

## [1.3.0] - 2026-09-24

### Added

- Image popover: zoom with the mouse wheel or `+`/`-`, stepping through Editor-style levels (fit, then 1×–4× the image's natural size) anchored at the cursor or centre. Drag with the mouse (or one finger) to pan a zoomed image, or use `Shift`+arrows to pan by 5% of the overflow. Pinch and double-tap zoom are unchanged.
- Image popover: `Esc` now resets the zoom first and closes the popover on a second press.

## [1.2.0] - 2026-09-24

### Added

- Table screen: `Esc` and `↓`/`Enter` in the filter field now jump to the first row (falling back to the unselected table when nothing matches), and `Esc` on the deselected table clears the active filter — matching the Editor's filters → first row → deselect → clear cascade. Pressing `↑` (or `k`) on the first row steps back out into the filter field; `Home` still lands on the first row.

### Fixed

- Table screen: clicking into the filter field with the mouse now drops the keyboard row selection, so the selection ring no longer lingers behind the field (previously only typing or `/` cleared it).

## [1.1.0] - 2026-09-21

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
