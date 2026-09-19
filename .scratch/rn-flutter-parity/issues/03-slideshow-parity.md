Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

What is the Note slideshow parity spec: dark full-screen per-note pager (front+back images, title, grading company, meta panel Date/Catalog/Grade/Serial/Watermark/Tags/Source URL/Notes), `1/N` + Back, tag-tap closes + filters table, Esc/←/→ equivalents and back behavior in RN, in light of the pipeline decision (ticket 01) and palette tokens (ticket 06)? HITL — resolve only in live exchange with a human.

## Comments

*(resolution will be appended under `## Answer` with `Status: resolved` on completion)*

## Answer

All Round-1 defaults accepted 2026-09-19. RN Note slideshow spec:

1. **Form:** full-screen dark `Modal` over single `AppShell` (`viewerDark` tokens), horizontal pager over `filteredNotes`. No stack navigator; revisit only if Import ticket forces it.
2. **Scope vs 04:** 03 owns pager + meta panel + open/return contract. Image-tap opens Image popover with `(noteId, front|back)` target; popover returns `noteId` and slideshow jumps to it. Fit/zoom/pinch/double-tap internals belong to 04.
3. **Content per slide:** scrollable card — centered title (`denomination - catalogNumber`, `Untitled note` fallback), grading company in dark accent, front then back preview (`previewFor`, aspect 1.65, `contain`, `No image`/`Missing image` fallbacks), meta panel (`viewerDark` raised surface): non-empty Date/Catalog/Grade/Serial/Watermark rows only; Tags section only if non-empty (wrap chips, `tagBackground/Border/Text`); Source URL tappable; Notes always (`No extra notes.` fallback). Bottom fade gradient hides at scroll bottom. Header: `1/N` pill (dark scrim, radius 18) + tonal Back button.
4. **Tag-tap:** closes slideshow returning `(noteId, tagName)`; table sets query to `tags: <name>` (canonical per 07, fixing Flutter's raw-name inconsistency) + scroll-reveals `noteId`.
5. **Keyboard/back:** Esc closes with current `noteId`; ←/→ prev/next with wrap-around; Android hardware back (`onRequestClose`) + iOS swipe-dismiss route through same close-with-`noteId`. ←/→ active on desktop-like only.
6. **Source URL:** scheme-normalize (prepend `https://` when missing), open externally via `Linking.openURL`. No in-app webview.
7. **Layout:** one shared pager/card on desktop-like + mobile (adapt by width, no fork). Images via built-in `<Image uri: file://…>` per 01; colors via flat `viewerTheme.viewerDark` per 06.
