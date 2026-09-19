Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

What is the Image popover + Zoom view parity spec (canonical terms; Flutter calls it lightbox L2): collection-wide front/back sequence with counter, Back returns `noteId` to sync the Note slideshow, fit view by default vs Zoom view at 1:1 only when natural size exceeds space (pannable, never smaller than fit), pinch focal/span + double-tap toggle (Flutter caps ~12x, disables pager physics on multi-touch)? Decide RN gesture/zoom equivalents. HITL — resolve only with a human.

## Answer

RN Image popover + Zoom view matches Flutter (`image_lightbox.dart`, v1.0.5+6) behaviorally, built-ins first:

- **Sequence**: collection-wide front/back interleaved (2N, wrap-around). Nulls kept as "No image" placeholder pages so the counter stays positional.
- **Header**: counter `k / 2N` in dark-scrim pill + note title + `Back`. Always-dark popover (`darkBackground` scaffold, scrim pill) regardless of app theme; resolves 06's dark-screen TODO.
- **Fit / Zoom view**: fit-by-default (contain); Zoom view = 1:1 only when natural size exceeds space, pannable, never smaller than fit; cap ~12x (larger only if 1:1 demands it). Zoom resets on page change.
- **Gestures (built-ins only, per 01)**: `Modal` + horizontal paging + nested zoom; hand-rolled double-tap toggle anchored at tap; pager disabled while zoomed/multi-touch. Escalate to `gesture-handler`/`reanimated`/`pager-view` only if builder shows focal pinch is unachievable.
- **Back + sync**: close returns current `noteId`; Note slideshow (03) jumps to it. Same contract on Android hardware back (`BackHandler`) and desktop Esc; ←/→ navigate on desktop-like, swipe elsewhere.
- **States**: per-image spinner while resolving; "Couldn't load image" + swipe-on on failure (no retry v1). Title-only header, no source-URL tap in popover (belongs to 03).
- **A11y**: labels on prev/next/Back/zoom ("Image k of N, \<title\>", "Back to slideshow").
- **Edge for 03**: slideshow must accept a "jump to noteId" hook for the return sync.
