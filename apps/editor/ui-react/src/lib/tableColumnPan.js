// Shared constants and pure helpers for panning the Table screen's columns
// horizontally. Mirrors the Viewer's Flutter table (notes_table_screen.dart):
// the horizontal scrollbar is hidden, so off-screen columns are reached by
// dragging the table with the mouse or by pressing Left/Right.

// How far one Left/Right arrow press pans the table's hidden columns.
export const COLUMN_SCROLL_STEP = 200;

// Flutter arms a mouse pan after its "precise pointer" slop of 2 logical
// pixels, so the first couple of pixels of movement start the drag without
// turning an ordinary click into a pan.
export const COLUMN_PAN_THRESHOLD_PX = 2;

// Presses that must keep their own gesture instead of starting a column pan:
// filter fields keep text selection, and the reorder handle keeps its native
// HTML5 drag. Every other surface (rows, header, sort buttons, links, tag
// chips) can be dragged to pan, matching the Flutter table.
const nonPanTargetSelector =
  "input, textarea, select, [contenteditable='true'], [draggable='true'], .drag-handle";

export function isColumnPanTarget(target) {
  return !(target instanceof Element && target.closest(nonPanTargetSelector));
}

// Clamps a horizontal scroll target to the scroller's real range. Kept pure so
// the drag handler and the arrow-key panner share one definition of how far
// the table can actually scroll.
export function clampColumnScrollLeft(current, delta, max) {
  const start = Number.isFinite(current) ? current : 0;
  const limit = Number.isFinite(max) && max > 0 ? max : 0;
  const moved = start + (Number.isFinite(delta) ? delta : 0);
  return Math.min(Math.max(moved, 0), limit);
}

// Where a drag lands: dragging the pointer right (positive dx) pulls the
// table back toward its start, so the scroll offset moves the other way.
export function columnPanScrollLeft({ startScrollLeft, startX, clientX, max }) {
  return clampColumnScrollLeft(startScrollLeft, -(clientX - startX), max);
}
