// Placement for the Editor's floating option lists. The list opens below its
// field when it fits, flips above when the field sits near the bottom of the
// window, and always clamps its height to the space that remains so the menu
// can never be cropped by the viewport.
const LIST_GAP = 4;
const VIEWPORT_MARGIN = 8;

export const FLOATING_LIST_MAX_HEIGHT = 220;

export function floatingListLayout(
  anchor,
  contentHeight = FLOATING_LIST_MAX_HEIGHT,
) {
  const bounds = anchor.getBoundingClientRect();
  const top = bounds.top ?? 0;
  const bottom = bounds.bottom ?? top + (bounds.height ?? 0);
  const width = Math.min(
    bounds.width ?? 0,
    window.innerWidth - VIEWPORT_MARGIN * 2,
  );
  const spaceBelow = window.innerHeight - bottom - LIST_GAP - VIEWPORT_MARGIN;
  const spaceAbove = top - LIST_GAP - VIEWPORT_MARGIN;
  const desired = Math.min(contentHeight, FLOATING_LIST_MAX_HEIGHT);
  const openUp = spaceBelow < desired && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    0,
    Math.min(FLOATING_LIST_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow),
  );
  const left = Math.min(
    Math.max(VIEWPORT_MARGIN, bounds.left ?? 0),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  );

  return openUp
    ? {
        bottom: window.innerHeight - top + LIST_GAP,
        left,
        maxHeight,
        width,
      }
    : {
        left,
        maxHeight,
        top: bottom + LIST_GAP,
        width,
      };
}
