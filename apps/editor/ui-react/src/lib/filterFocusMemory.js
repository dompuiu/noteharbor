// Whether ArrowUp (or k) should leave the focused row and return to the
// filter row. Only the very first row hands off: from any other row there is
// a row above to move to. Requiring the row element to actually hold focus
// keeps stale focus memory (e.g. after clicking a button) from hijacking the
// key, and a missing row focus keeps the old clamp-to-first-row behaviour.
export function shouldHandOffToFilters({
  activeElement,
  currentIndex,
  offset,
  rowElement,
}) {
  return (
    offset < 0 &&
    currentIndex === 0 &&
    rowElement != null &&
    rowElement === activeElement
  );
}
