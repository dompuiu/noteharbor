# Changelog

All notable changes to the Note Harbor Viewer (Flutter app) are documented in this file.

## [Unreleased]

### Added

- Image popover: each page is one screen-reader label - the note, its date, the face and the counter's words - with image semantics and a `Double-click to zoom` hint that the page's own action performs.
- Image popover: page changes and a missing or failed note image are announced through a polite live region on the stage, while the zoom level keeps its own readout. Every zoom stop is a focusable button in reading order, and `Esc` and `Back to note` still work from a focused control.
- Image popover: the header now carries a Front | Back face toggle beside the counter and the Editor's zoom instrument - Fit | 1:1, then minus, the live level as a percentage of the scan's real size, and plus. Fit is pressed and disabled at the fit view, 1:1 is pressed and disabled at actual size, and both stops go inert when the page has no image or the image fails to load. The mat shows a zoom-in cursor. Wheel, double-click, pinch and keys still zoom as accelerators.
- Table screen: the collection switcher now leads with All notes, a read-only scope over every collection's notes with their combined count. All notes opens grouped by collection name, adds a sortable Collection column that only this scope shows (and, below 700 logical px, a collection label on each card), and keeps the active collection selected underneath, so leaving the scope returns to that collection's table. The scope and the chosen collection survive restarts.
- Import screen: a successful import offers a `View <collection>` action that returns to the table on the imported collection.
- Import screen: on desktop, `Show in folder` opens the imported archive's folder in the system file manager.
- Import screen: the archive drop zone accepts a `.zip` dragged from the OS on desktop, and names the drag-over state `Drop to choose`. A non-.zip or multi-file drop reports in the status banner. iOS has no drop target in `desktop_drop`, so its hint only promises the tap.

### Changed

- Image popover: each page's mat now names its face, the position pill reads `Image 2 of 7` (adding `Note 3 of 214` when the sequence spans notes), and the exit reads `Back to note` so it no longer collides with the note's back face.
- Image popover: the top bar reads like the slideshow's - the note title and date on the left with the position pill at the right of that line, then the face toggle and zoom instrument with `Back to note` as one right-aligned cluster beneath. The pill hugs its own lines instead of spanning the header, drops under the title when a long headline or a large text size needs the whole line, and the cluster wraps under itself on a phone.
- Import screen: the archive's date and collection count are one inset summary strip instead of pills - label/value cells on a mist ground, split by a hairline, one row at 480 px and wider and two stacked rows below that, never wider than 720 px. The active collection's note count drops out of the strip because the collection select below already shows it, and a screen reader hears each cell as one `label: value`.
- Import screen: the page caps its content in a centered 720 px column, so panels and copy keep a readable measure on wide windows instead of stretching across the page.
- Import screen: one noun per concept — the file is an archive and what it holds is a collection. The app bar and import panel read Import archive, the Notes stat names its collection, and the two destructive panels collapse into one subordinate Remove section with a row per scope.
- Import screen: first run is one card with one action — an eyebrow, a title, one sentence, the archive drop zone, and a single primary pill that chooses the archive then imports it. The management, active-collection, and delete panels stay hidden on first run, so the status banner lands above the fold on a phone; an imported archive with no collections still offers Delete archive.
- Import screen copy: written for collectors — first run opens with "Bring your notes in" and one instruction to choose the archive exported from Note Harbor Editor, the replace-by-name rule appears once in the confirmation, and developer terms (file formats, database files, "dataset") are gone.
- Import screen: the drop zone is now the only picker. It takes focus, opens the picker on Enter or Space, and draws a 2px accent focus ring beside the hover treatment; the duplicate `Choose archive` button is gone and `Import archive` waits for a selection. Its hint names drop plus click on desktop and drop plus tap on Android; iOS keeps the tap wording.

### Fixed

- Import screen: import outcomes are announced to screen readers, and a failed import names what went wrong without Dart's `Bad state:`/`Exception:` prefixes and ends with the recovery step. The banner no longer jumps a scrolled page, focus moves to the banner's action after a success and back to Import archive after a failure, and a failure stays until the import is retried or the banner is dismissed.
- Import screen: the drop zone fades to a single pale-red fill when a drag is over it. The fill used to animate into a translucent accent wash, and the color tween dipped through a half-alpha red, flashing a saturated pink before settling.

## [1.14.1] - 2026-11-10

### Changed

- Table screen: a card's tag footer now spans the whole card, so the rule and the chips start under the mounted plate and pack into fewer rows. Card chips keep their 44 pt width but use a 32 pt vertical target and sit closer together; the grid keeps the full 44 pt target.

## [1.14.0] - 2026-11-10

### Added

- Table screen: the collection title is now a collection switcher. It stays a plain uppercase heading at rest, with a small chevron beside the name. The menu lists every collection with its note count, filters as you type, and switches on click, Enter, or the arrow keys. Libraries with a single collection keep the plain title.
- Table screen: below 700 logical px the nine-column grid becomes a vertical card list — a 96x56 front thumbnail, the denomination, labelled metadata for every column, and tag chips. Sorting moves into a compact bar, keyboard selection and the Tab chain carry over, and the list never scrolls horizontally.
- Table header: a live range footer names the visible rows, replacing the silent column cut. Headers align with their data, the sorted state is named for assistive tech, and keyboard focus draws a real ring.

### Changed

- Table screen: the note counter and import action always share the collection-title line, even on a narrow window; long collection names ellipsize between them.
- Table screen: notes mount as catalogue plates on the grey tray, with the denomination as the plate title and the date alongside. Catalogue number, company, grade, and serial sit in a quiet spec line, grades wear the uncirculated/choice/circulated bands, and a reverse-image peek shows the back.
- Table screen: density, columns, and the filter bar were rebalanced for scanning. The filter scope stays wide enough to keep `Catalog` readable at 320 px, tags cap at 320px behind a `+N more` menu that filters on selection, and every empty value shares one muted dash.
- Table screen: sorting follows domain order and resets the scroll position, so a new sort starts at the top of the collection.
- Table screen: empty-collection and no-matches states are now distinct, and empty-collection offers Import while no-matches offers Clear filter.
- Table screen: rows, tag chips, and the collection switcher are accessible. Rows announce one label with a hint and selection state, chips are 44 pt filter buttons with a focus ring and Enter/Space, the counter is a live region, and serial and catalog numbers copy from a long-press menu, Ctrl/Cmd+C, or an assistive action.
- Buttons across the import screen, slideshow, lightbox, and table share one style: explicit disabled colors and border, a 40px minimum height, hover feedback, and a soft-red tonal variant for destructive actions.
- The app now requires Flutter 3.47 / Dart 3.13, matching `window_manager` 0.6 and `screen_retriever` 0.3.

### Fixed

- Table screen: the scrollbar no longer duplicates, and filter text centers in its field.
- Table screen: End, PageDown, and a slideshow return now reveal the selected card, including cards the lazy list had not built yet.
- Table screen: loading and load errors render as in-card states with no raw exception text, a copy block, Try again, and an import escape; first-run and no-archive now route to Import instead of the error card.
- Windows desktop: the built executable is `note_harbor_viewer.exe` again, so `flutter run -d windows` (and `pnpm dev:viewer:flutter`) can launch it. The `Note Harbor Viewer.exe` OUTPUT_NAME override is gone; the window title and file metadata still carry the pretty name.
- Desktop window persistence, after moving to the nativeapi-based `window_manager` 0.6 and `screen_retriever` 0.3 packages: the desktop build compiles again, and position, size and the Windows maximized state still restore on launch.

## [1.13.0] - 2026-11-07

### Changed

- The whole app now wears the editor's neutral ink-and-red theme: a white-to-grey surface ladder, charcoal ink, one deep-red accent, and the Ochre tag family replace the warm paper palette. Cards and chrome are flat, buttons are pills, and the slideshow room and lightbox sit on light surfaces over a near-black scrim.

### Fixed

- Windows viewer icon: the ICO now carries 256/128/64/48/32/24/16 frames generated from the 1024px master, so the shell no longer downscales a single 256px frame for smaller sizes.

## [1.12.0] - 2026-10-16

### Changed

- Table screen: the filter bar is now a field-scope select plus the text input — pick All fields, Catalog (the default), Denomination, Date, Company, Grade, Serial, or Tags, then type the value. The inline `field:` prefixes (`cat:`, `denom:`, …) are retired and now match literally. Tapping a tag chip sets the scope to Tags; clearing resets the text only, and the scope resets when switching collections.

### Fixed

- Table screen: hovering the filter field no longer washes its background — the bar keeps one flat surface, and the scope menu's options now lift to a warm wash on hover so the hovered option reads as selected.
- Table screen: the filter scope select highlights label and arrow as one unit on hover and on keyboard focus, and the open scope menu highlights the arrow-keyed option exactly like a hovered one.
- Table screen: picking a filter scope hands typing focus to the filter field, so a new value can be typed immediately.
- Image popover: a narrowing pinch that settles within 20% of the fit size (up from 10%) now snaps the rest of the way to fit, so the sequence stays swipeable instead of resting a few pixels above fit until a double tap.

## [1.11.0] - 2026-10-11

### Removed

- Import screen: the `Set as default collection` button and the default-collection flag are gone, including the `(default)` suffix and the `Active source` pill. The `Notes (active)` pill is now `Notes`, and `Delete active collection` is `Delete collection`.

### Added

- The app now remembers the last selected collection across restarts (ID with name fallback, so re-imports that churn IDs still restore the right collection).

### Fixed

- Delete collection: the collection is resolved by ID with a name fallback, child rows are deleted in a transaction, and failures name the collection plus the available ones. Delete errors now show inline under the Active collection panel.

## [1.10.2] - 2026-10-11

### Changed

- Import screen: the import progress overlay now shows only the spinner, the `Importing archive…` status, and the archive name, dropping the extra hint line.

## [1.10.1] - 2026-10-11

### Fixed

- Archive import: archives exported without the retired default-collection flag now import instead of failing with `no such column: is_default`. The viewer's local default flag is ensured on the installed database, and any archived flag stays ignored.
- Import screen: the import result banner now sits directly under the Archive import panel and scrolls into view, so failures are visible without hunting at the bottom of the screen.

### Changed

- Import screen: polished the import progress overlay.

## [1.10.0] - 2026-10-04

### Added

- Image popover: the note's date is now shown on a smaller line beneath the denomination and catalog number in the header.

### Fixed

- Image popover: a pinch that settles within 10% of the fit size now snaps the rest of the way to fit, so the sequence stays swipeable instead of resting a few pixels above fit until a double tap.

## [1.9.2] - 2026-10-01

### Changed

- Note slideshow and Image popover: the keyboard wrap now glides across the seam like a swipe, instead of landing instantly. `←`/`→` (and the chevrons, plus `h`/`l` in the slideshow) pass seamlessly from the last item to the first and back; `Home`/`End` still jump.

## [1.9.1] - 2026-10-01

### Added

- Note slideshow and Image popover: a left/right mouse drag now moves to the previous/next item, so the desktop viewer can be paged with the mouse alone. The drag is horizontal only — a vertical mouse drag still does nothing to the note card, and in the popover a drag while zoomed keeps panning the image.

### Changed

- Note slideshow and Image popover: swiping or dragging past either end now wraps seamlessly — the page follows the pointer across the seam instead of stopping at the ends. `←`/`→`, the chevrons and `Home`/`End` keep their instant wrap; only the pointer gesture glides.

## [1.9.0] - 2026-10-01

### Changed

- Note slideshow and Image popover: previous/next now wrap around — `←` on the first note lands on the last, and `→` on the last lands on the first, instead of stopping at the ends. This also covers the popover's modified `←`/`→` in fit view. A wrap that jumps across other items lands instantly rather than animating through them; `Home` and `End` are unchanged.

## [1.8.0] - 2026-10-01

### Added

- Note slideshow: `Home` and `End` jump to the first and last note; the Image popover gains the same two keys over its front/back sequence. Both jumps land instantly rather than animating through every item.
- `h`/`j`/`k`/`l` now alias the arrow keys in the Table screen, Note slideshow, and Image popover.
- Table screen: `Shift`, `Cmd`, or `Ctrl` + `←`/`→` (and the `h`/`l` aliases) jump the columns to the first or last.

### Changed

- Keyboard: `Ctrl`, `Cmd`, and `Shift` are interchangeable for the arrow intents in the Table screen and Image popover; `Alt` stays inert.
- Table screen: row focus moves only with the plain arrows and plain `j`/`k` — `Shift`+`↑`/`↓` and `Shift`+`j`/`k` no longer move the selection, and `Shift`+`↓` in the filter field is a no-op.
- Image popover: in fit view, modified `←`/`→` (and `h`/`l`) page the images; modified `↑`/`↓` do nothing.
- Updated dependencies.

## [1.7.0] - 2026-09-27

### Changed

- Table screen: the row cursor now survives mouse use, matching the Editor — pressing, dragging (column pan), or wheel-scrolling no longer drops it.
- Table screen: closing the slideshow repaints the row cursor on the returned row whether the note was opened with the keyboard or the mouse (opening still clears it).

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
