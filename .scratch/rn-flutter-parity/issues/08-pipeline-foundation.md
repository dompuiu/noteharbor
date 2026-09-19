# 08: Pipeline foundation

**What to build:** Archive pick → import → render Note images end to end. Choosing an Archive file, applying it with a back-blocking busy overlay, and seeing front/back Note images render (thumbnail variant in lists, full variant in overlays) with the ported dataset-built date available for pills.

**Blocked by:** None (can start immediately).

**Status:** resolved

## Answer

Built on `main`, tests-first at the viewer-core + controller seams:

- Archive picker dep `@react-native-documents/picker@12.0.2` added; `src/native/archivePicker.ts` wraps `pick({type:[types.zip]})` (platform UTI, not a hardcoded MIME), normalizes `file://` percent-encoded URIs to local paths, returns `null` on cancel and on Windows (manual-path fallback signal; input UI belongs to ticket 12).
- `noteImageUri` in viewer-core + `NoteImageView` (built-in `Image`, `contain`, bundled-asset `fallbackSource`, themed `No image` placeholder, light/dark tone); preview/full composition asserted (`noteImageUri(notePreviewImage(...))` → thumb, `noteFullImage` → full).
- `formatFriendlyDatasetBuiltAt` exact-ports Flutter's `dataset_date_format.dart`; `describeDatasetBuiltAt` falls back to `Not available yet`.
- `ImportBlockingOverlay` (`Modal` + `ActivityIndicator`, `onRequestClose` noop) wired into `AppShell` on `isMutating`; unzip loop yields every 8 writes; no threading lib.
- Controller exposes `sortKey`/`ascending`/`setSort` (default `displayOrder`/asc; same key flips, new key resets); `filteredNotes` uses them instead of the hardcoded sort.
- Jest harness fixed for component tests (RN setup file, pnpm-aware transform patterns, `window.dispatchEvent` stub).

Verified: jest 8 suites / 40 tests pass; tsc clean on all touched files (remaining errors pre-existing on HEAD); eslint clean on all touched files (11 remaining errors pre-existing on HEAD).

- [x] Archive picker dependency added; `.zip` filter on iOS/macOS, manual-path fallback on Windows
- [x] Note images render from local file URIs (preview variant for thumbnails, full variant for overlays) with bundled-asset fallback and themed placeholder on null/error
- [x] Dataset-built friendly date helper lives in the shared core and matches Flutter copy with `Not available yet` fallback
- [x] Import runs with a blocking modal overlay driven by the existing mutating flag; back navigation blocked while busy; no new threading library (chunked/yielded unzip)
- [x] Controller exposes sort-key/ascending state (no longer hardcoded) for the Table screen to wire headers to
- [x] Core pure-function tests + controller mutation tests pass; lint/typecheck clean for touched modules

## Comments
