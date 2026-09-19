# 10: Note slideshow parity

**What to build:** The dark full-screen Note slideshow pager over the filtered notes: per-Note card with title, grading company, front-then-back images, meta panel, `1/N` pill plus Back, tag-tap close-and-filter, keyboard/back handling, external Source URL open, and image-tap handoff to the Image popover with jump-back sync.

**Blocked by:** 08 (images, theme tokens), 09 (table open/return contract, filtered notes order).

**Status:** resolved

## Answer

Built on `main`, tests-first at the viewer-core + component seams
(`NoteSlideshow.test.tsx`, 18 tests; `viewer-core` URL test):

- `src/components/NoteSlideshow.tsx`: full-screen dark `Modal` over the single `AppShell` (`viewerDark` + `viewerRadii` tokens only); horizontal paging `ScrollView` over `notes`; one shared pager/card adapted by `useWindowDimensions` width, no fork.
- Per-slide scrollable card: centered title via core `noteTitle` (`Untitled note` fallback), dark-accent company (hidden when empty), front-then-back previews via `NoteImageView tone="dark"` (width-adapted, aspect 1.65, `No image` null / `Missing image` error through the shared placeholder), meta panel on the dark raised surface with non-empty Date/Catalog/Grade/Serial/Watermark rows only, Tags section only when non-empty, tappable Source URL, `No extra notes.` fallback. Bottom fade (translucent-strip approximation — RN has no built-in gradient, no new dep) hides at scroll bottom.
- Header `1/N` dark-scrim pill + tonal Back. Tag-tap closes with `(noteId, tagName)`; Back / `onRequestClose` (Android) / `onDismiss` (iOS swipe) close with current `noteId` through one guarded close (resolves once). Esc closes everywhere, arrows prev/next with wrap on `isDesktopLike` only (defaults to macOS/Windows/web; `window` keydown covers web — native macOS/Windows key events need a native key module, out of scope).
- Source URL via core `normalizeSourceUrl` (trim, keep scheme, else `https://`, null on empty/whitespace) opened with `Linking.openURL`; no webview. Image-tap calls optional `onOpenPopover(note, face)`; returned `noteId` jumps via the exposed `jumpToNoteId` ref hook (ticket 11 target). `App.tsx` bridges `onOpenSlideshow` with promise state resolving the table's `OpenSlideshow` contract.
- `NoteImageView`: extracted shared placeholder render + `errorLabel` prop (default `No image`, preserving ticket 08 fallback-asset behavior).

Verified: jest 10 suites / 75 tests pass; tsc clean on all touched files (remaining errors pre-existing on HEAD); eslint clean on touched files.

- [x] Full-screen dark modal over the single app shell using dark tokens; horizontal pager over filtered notes; one shared pager/card adapted by width, no fork
- [x] Per-slide scrollable card: centered title with `Untitled note` fallback, dark accent company, front-then-back previews with `No image`/`Missing image` fallbacks, meta panel showing only non-empty Date/Catalog/Grade/Serial/Watermark rows, Tags section only when non-empty, tappable Source URL, `No extra notes.` fallback, bottom fade hidden at scroll bottom
- [x] Header `1/N` dark-scrim pill plus tonal Back; tag-tap closes returning `(noteId, tagName)` so the table sets `tags: <name>` and reveals the Note
- [x] Esc closes with current Note identity; arrow keys prev/next with wrap on desktop-like only; Android hardware back and iOS swipe-dismiss route through the same close-with-Note path
- [x] Source URL scheme-normalized and opened externally via linking; no in-app webview; image-tap opens the popover with a face target; exposes a jump-to-Note hook for the popover return
- [x] Interaction tests: pager position, meta-panel row suppression, tag-return values, Esc/arrow/back paths, URL normalization

## Comments

- [ ] Full-screen dark modal over the single app shell using dark tokens; horizontal pager over filtered notes; one shared pager/card adapted by width, no fork
- [ ] Per-slide scrollable card: centered title with `Untitled note` fallback, dark accent company, front-then-back previews with `No image`/`Missing image` fallbacks, meta panel showing only non-empty Date/Catalog/Grade/Serial/Watermark rows, Tags section only when non-empty, tappable Source URL, `No extra notes.` fallback, bottom fade hidden at scroll bottom
- [ ] Header `1/N` dark-scrim pill plus tonal Back; tag-tap closes returning `(noteId, tagName)` so the table sets `tags: <name>` and reveals the Note
- [ ] Esc closes with current Note identity; arrow keys prev/next with wrap on desktop-like only; Android hardware back and iOS swipe-dismiss route through the same close-with-Note path
- [ ] Source URL scheme-normalized and opened externally via linking; no in-app webview; image-tap opens the popover with a face target; exposes a jump-to-Note hook for the popover return
- [ ] Interaction tests: pager position, meta-panel row suppression, tag-return values, Esc/arrow/back paths, URL normalization
