# Handoff: Image popover zoom view (web Editor)

Status: **Design fully agreed, implementation not started.**

## What we decided

Add a **Zoom view** to the `ImagePopover` in the web Editor (`apps/editor/web/src/components/Slideshow.jsx:119`). The glossary term `Zoom view` was added to `CONTEXT.md` during the design session — that is the only artifact change so far.

### Behavior spec (settled by Q&A, do not re-litigate)

- **Scope**: web Editor app only. `apps/editor/desktop` just wraps the web app via Electron, so it gets this for free. Nothing in `apps/viewer` or `apps/editor/server`.
- **Zoom in**: double-click the image, or press `+`. Renders the note image at natural pixel size (1:1, CSS px = image px), with the stage layout unchanged.
- **Zoom out**: double-click again, or press `Esc`. **Esc while zoomed only unzooms** — a second Esc (when unzoomed) closes the popover as it does today.
- **Clamping rule**:
  - If the image's natural size ≤ available space: the image is shown at **fit size (never smaller than the current fit view)** and is **not pannable**.
  - If the image's natural size > available space: shown at 1:1, pannable, but always covering the stage — clamped so the image edge stops at the stage edge (can never be dragged to reveal empty space outside the image).
- **Pan inputs**:
  - Pointer drag (mouse and touch via Pointer Events; **no pinch zoom**).
  - **Shift + arrow keys**: pan 5% of the current overflow in that direction per press (auto-repeat handles holds). Only active when pannable.
  - **Plain arrows still navigate** to previous/next image at all times (when zoomed, plain arrows navigate AND the zoom resets to fit view; Shift+arrows pan instead).
  - **Cursor**: `grab` on hover over a pannable zoomed image, `grabbing` while dragging. Default cursor in fit view or when zoomed but not pannable.
- **Reset**: navigating to another image (arrows, on-screen arrows, `+` counter navigation) resets to fit view, offset zero.
- **No single-click action** on the image (double-click is the only mouse toggle).
- **No `data-shortcut` pill changes** beyond the new keys if that pattern is kept; the existing `data-shortcut` attributes on popover buttons stay as-is.

## Where to implement

- Component: `apps/editor/web/src/components/Slideshow.jsx` — `ImagePopover` (lines 119–215). State (zoomed bool, px/pan offsets) lives in this component; no new props needed.
- Current image rendering: plain `<img>` inside `.image-popover-image-wrap` (Slideshow.jsx:190–199).
- CSS: `apps/editor/web/src/styles.css` — `.image-popover-image-wrap img` at line 1610 (`max-width: 100%; max-height: min(72vh, 760px); object-fit: contain;`). The stage is `.image-popover-stage` (line 1573), a 3-column grid with arrows in the outer columns and the image wrap in the middle.
- Keyboard handling already exists: `useEffect` keydown listener in `ImagePopover` (Slideshow.jsx:131–150) handles Esc/ArrowLeft/ArrowRight. Extend it — note the Esc ordering requirement (zoomed → unzoom; unzoomed → onClose).
- Existing conventions to follow: no new libraries (plain React + CSS, no CSS modules), no comments in code unless asked.

## Verification

- `pnpm` workspace monorepo. The web package name is `editor_web` (apps/editor/web/package.json); it has no lint/test scripts — only `dev` (vite), `build`, `preview`. There is no test harness for this component — verify manually:
  1. From the repo root: `pnpm dev` (boots editor_server + editor_web via concurrently).
  2. Open a note → open the Image popover → confirm: fit view unchanged; double-click on an image larger than the stage → 1:1, pan clamps so the image always covers the stage, `grab`/`grabbing` cursors; Shift+arrows pan ~5% of overflow; plain arrows still navigate and reset the zoom; `+` zooms in (does not toggle out); Esc unzooms first, second Esc closes.
  3. Confirm the desktop build still behaves (Electron wraps the same web app — `pnpm --filter editor_desktop build:win` only exists as a build target; the running behavior is the same web bundle).

## Suggested skills for the next agent

- `implement-spec` — implement this spec against the codebase.
- `tdd` — if manual verification proves awkward, wrap the pan/clamp math in a helper and test it.
- `code-review` — after implementation, review against the spec above.

## Out of scope

- Viewer app, iOS, pinch zoom, multi-level zoom (1:1 only), zoom state persistence, single-click zoom affordance.
