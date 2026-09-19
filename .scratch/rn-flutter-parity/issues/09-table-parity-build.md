# 09: Table screen parity

**What to build:** The Table screen as the app's main screen: 9 sortable columns with Flutter widths and 80px rows, one-row header with logo badge plus `Notes: visible/total` pill plus 48px import button, tag-tap to filter, row-tap into the Note slideshow with filtered return, single adaptive table with horizontal scroll on narrow widths, search chrome, and themed empty row.

**Blocked by:** 08 (needs image rendering, sort-key state, picker groundwork for the import button target).

**Status:** resolved

## Answer

Built on `main`, tests-first at the component/contract seam
(`NotesTableScreen.test.tsx`, 16 tests):

- `src/components/NotesTableScreen.tsx`: 9 columns at Flutter widths (ID 90 / Front 120 / Denomination 190 / Date 120 / Catalog 130 / Company 120 / Grade 110 / Serial 140 / Tags dynamic ≥160), 80px rows; sortable headers except Front wired to controller `setSort` (flip/resets/default `displayOrder` asc from 08), arrow on active; one-row header (logo badge + `Notes: visible/total` pill + 48px import button gated on `canManageImportedDatasets` + `onOpenImport`); tag-tap → `tags: <name>` + h-scroll to 0; row-tap → `onOpenSlideshow(notes, index)`, return applies canonical `tags: <name>` and clamped scroll-reveal of `noteId`; single table with horizontal scroll at min content width; search chrome (verbatim Flutter hint, live-filter, `X` clear, maxWidth 420, collection-change clears query + resets scrollers); themed `No notes match the current filter.` row; 96×56 thumbs via `NoteImageView` (preview variant, themed `No image` placeholder). Owns and exports the `Table → slideshow (notes, initialIndex) → return {noteId, tagName}` contract (`SlideshowReturn`, `OpenSlideshow`) for ticket 10; `onOpenImport` entry point for ticket 12.
- `ViewerRepository.canManageImportedDatasets?` (optional, defaults true) exposed through the controller; no existing repository touched.
- `App.tsx`: single `NotesTableScreen` (no `isDesktopLike` branch); deleted `MobileViewerShell`, `DesktopViewerShell`, `DesktopNotesTable`, `ViewerHeader`, `ViewerFilter`. `ManagePanel` stays until ticket 12 deletes it; collection chips kept in the table screen until 12's dropdown lands. Also fixed pre-existing App loading-state style errors.
- Tags width is a char-width estimate (no cheap sync text measure in RN), not Flutter's `TextPainter`; rows render in a `ScrollView` (no virtualization) — fine for archive-sized collections.

Verified: jest 9 suites / 56 tests pass; tsc clean on all touched files (remaining errors pre-existing on HEAD — count dropped 26→20 lines by the App style fix); eslint clean on touched files except one pre-existing `loadDataset` unused-var error on HEAD.

- [ ] 9 columns (ID / Front thumbnail / Denomination / Date / Catalog / Company / Grade / Serial / Tags dynamic ≥160); Front column not sortable, all others flip on same key and reset ascending on new key with arrow on active, defaulting to collection order ascending
- [ ] Header is one row: logo badge + visible/total pill + import button gated on the manage permission; counts moved out of the shell; search syntax untouched (shared core stays canonical)
- [ ] Tag-tap sets query `tags: <name>` and scrolls horizontal to 0; row-tap opens the Note slideshow at index; return applies `tagName` to search and animated scroll-reveals `noteId` (clamped)
- [ ] One Table screen everywhere with horizontal scroll at a minimum table width; mobile card list deleted; thumbnails 96×56 with themed placeholder
- [ ] Search chrome: hint text, live-filter, `X` clear, constrained width, Collection change clears query and resets scrollers; owns the filtered-empty row; owns the `Table → Note slideshow (notes, initialIndex) → return {noteId, tagName}` contract
- [ ] Interaction tests: sort flips, pill counts, tag-tap query, row-tap index, narrow-width scroll container, empty-row copy
