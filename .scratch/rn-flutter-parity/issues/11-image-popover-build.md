# 11: Image popover plus Zoom view

**What to build:** The always-dark Image popover over the slideshow: collection-wide front/back paging with positional counter, fit-by-default with gated 1:1 Zoom view, built-in gestures, and Back that returns the current Note identity so the Note slideshow jumps to it.

**Blocked by:** 08 (image rendering, theme), 10 (slideshow jump-to-Note hook, face-target handoff).

**Status:** resolved

## Answer

Built on `main`, tests-first at the component/contract seam
(`ImagePopover.test.tsx`, 18 tests):

- `src/components/ImagePopover.tsx`: always-dark `Modal` over the slideshow (`viewerDark` + `viewerRadii` tokens only); collection-wide front/back interleaved sequence (2N via core `noteFullImage` + `noteImageUri`, nulls kept as `No image` pages); header note title + `k / 2N` dark-scrim pill + Back (`0 / 0` on empty); ‹ Prev / Next › footer (wrap-around) for the ticket's prev/next a11y labels.
- Zoom view: fit-by-default `contain`; `Image.getSize` natural size gates 1:1 (no-op when 1:1 never exceeds fit); double-tap toggles anchored at tap (pair-consuming window so triple-taps don't chain), pinch span-ratio + focal math ported from Flutter's `_ZoomableImagePage`, single-finger pan while zoomed, offset clamped, cap `max(1:1, 12)`; zoom + multi-touch reset on page change (`resetSignal`, mirroring Flutter's `_pageGeneration` key); pager `scrollEnabled` off while zoomed or multi-touch. No gesture/pager library.
- Close returns current `noteId` (null on empty) through one guarded close on every path: Back, `onRequestClose` (Android), `onDismiss` (iOS swipe), Esc; arrows prev/next with wrap on `isDesktopLike` only (window keydown covers web; Esc path is inherently desktop since only web delivers key events). Title-only header, no source-URL tap.
- Per-image spinner while resolving size plus overlay spinner until `onLoad`; `Couldn't load image` + swipe-on, no retry. A11y: prev/next position labels, Back label, zoom label on the image toggle plus a direct `toggleZoom` accessibility action (single AT activation works; touch keeps double-tap).
- `App.tsx`: popover promise-state bridged into `NoteSlideshow onOpenPopover` over the slideshow's filtered notes; return flows through the slideshow's existing jump-to-Note sync. Divergences from Flutter kept: visible prev/next buttons (ticket demands prev/next a11y labels; Flutter has keyboard-only nav), `slide` modal transition (house style from ticket 10).

Verified: jest 11 suites / 93 tests pass; tsc clean on all touched files (remaining errors pre-existing on HEAD); eslint clean on touched files.

- [x] Collection-wide front/back interleaved sequence (2N, wrap-around); nulls kept as `No image` placeholder pages so the counter stays positional; header `k / 2N` dark-scrim pill plus note title plus Back
- [x] Fit-by-default; Zoom view is 1:1 only when natural size exceeds space, pannable, never smaller than fit, capped ~12x (larger only if 1:1 demands it), reset on page change
- [x] Built-ins only: modal plus horizontal paging plus nested zoom with hand-rolled double-tap toggle anchored at tap; pager disabled while zoomed or multi-touch (escalate to gesture/pager libraries only with builder evidence)
- [x] Close returns current Note identity for slideshow sync on every exit path (button, Android back, desktop Esc); arrows navigate on desktop-like, swipe elsewhere; title-only header, no source-URL tap
- [x] Per-image spinner while resolving; `Couldn't load image` plus swipe-on with no retry in v1; accessible labels on prev/next/Back/zoom
- [x] Interaction tests: counter math with gaps, zoom-reset on page change, pager-disabled-while-zoomed, back-sync identity on each exit path
