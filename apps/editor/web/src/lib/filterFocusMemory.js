import { useCallback, useRef } from "react";

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

function focusElement(element) {
  if (!element || typeof element.focus !== "function") {
    return false;
  }

  element.focus();
  return true;
}

function focusAndSelect(element) {
  if (!focusElement(element)) {
    return false;
  }

  if (typeof element.select === "function") {
    element.select();
  }

  return true;
}

// Remembers which field of the filter row the user was last in, so `/` and
// ArrowUp from the first row can return there instead of always jumping to
// the left-most field. `orderedKeys` is the filter row's visible columns, in
// render order, and is the source of truth for the fallback field. Memory
// lives for the lifetime of the component (one session) and is deliberately
// not persisted.
export function useFilterFocusMemory(orderedKeys) {
  const elementsRef = useRef(new Map());
  const refCallbacksRef = useRef(new Map());
  const lastKeyRef = useRef(null);
  const orderedKeysRef = useRef(orderedKeys);
  orderedKeysRef.current = orderedKeys;

  // Stable ref callback per column key, so React does not detach/reattach the
  // ref on every render.
  const getFilterRef = useCallback((key) => {
    let callback = refCallbacksRef.current.get(key);

    if (!callback) {
      callback = (element) => {
        if (element) {
          elementsRef.current.set(key, element);
        } else {
          elementsRef.current.delete(key);
        }
      };
      refCallbacksRef.current.set(key, callback);
    }

    return callback;
  }, []);

  const rememberFilter = useCallback((key) => {
    if (key != null) {
      lastKeyRef.current = key;
    }
  }, []);

  // Focus a specific field without touching its contents. Used when focus is
  // moved programmatically for a reason other than "return to the filter".
  const focusFilter = useCallback((key) => {
    focusElement(elementsRef.current.get(key));
  }, []);

  // Focus the last field the user was in, falling back to the first visible
  // one when nothing is remembered or that column is no longer mounted, and
  // selecting its contents so typing replaces the previous value. Returns
  // whether focus actually moved.
  const focusRememberedFilter = useCallback(() => {
    const elements = elementsRef.current;
    const remembered = lastKeyRef.current;
    const key =
      remembered != null && elements.has(remembered)
        ? remembered
        : (orderedKeysRef.current.find((candidate) =>
            elements.has(candidate),
          ) ?? null);

    if (key == null) {
      return false;
    }

    // Point the memory at what we actually focused, so a column that went
    // away does not keep pulling us back to the fallback.
    lastKeyRef.current = key;

    return focusAndSelect(elements.get(key));
  }, []);

  return { focusFilter, focusRememberedFilter, getFilterRef, rememberFilter };
}
