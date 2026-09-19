# 11: Image popover plus Zoom view

**What to build:** The always-dark Image popover over the slideshow: collection-wide front/back paging with positional counter, fit-by-default with gated 1:1 Zoom view, built-in gestures, and Back that returns the current Note identity so the Note slideshow jumps to it.

**Blocked by:** 08 (image rendering, theme), 10 (slideshow jump-to-Note hook, face-target handoff).

**Status:** ready-for-agent

- [ ] Collection-wide front/back interleaved sequence (2N, wrap-around); nulls kept as `No image` placeholder pages so the counter stays positional; header `k / 2N` dark-scrim pill plus note title plus Back
- [ ] Fit-by-default; Zoom view is 1:1 only when natural size exceeds space, pannable, never smaller than fit, capped ~12x (larger only if 1:1 demands it), reset on page change
- [ ] Built-ins only: modal plus horizontal paging plus nested zoom with hand-rolled double-tap toggle anchored at tap; pager disabled while zoomed or multi-touch (escalate to gesture/pager libraries only with builder evidence)
- [ ] Close returns current Note identity for slideshow sync on every exit path (button, Android back, desktop Esc); arrows navigate on desktop-like, swipe elsewhere; title-only header, no source-URL tap
- [ ] Per-image spinner while resolving; `Couldn't load image` plus swipe-on with no retry in v1; accessible labels on prev/next/Back/zoom
- [ ] Interaction tests: counter math with gaps, zoom-reset on page change, pager-disabled-while-zoomed, back-sync identity on each exit path
