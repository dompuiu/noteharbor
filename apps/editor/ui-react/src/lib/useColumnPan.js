import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  COLUMN_PAN_THRESHOLD_PX,
  clampColumnScrollLeft,
  columnPanScrollLeft,
  isColumnPanShadowVisible,
  isColumnPanTarget,
} from "./tableColumnPan.js";

// The Table screen hides the horizontal scrollbar and reaches off-screen
// columns by dragging the table or pressing the arrow keys. The gesture and
// its geometry are the same on every screen that paints the table, so they
// live here instead of being copied into each one.
//
// `measureDeps` names the values that change the rendered column widths (the
// table's measured width, the visible columns, the scrollbar gutter); the hook
// re-checks whether the columns overflow whenever one of them changes.
export function useColumnPan({ measureDeps = [], onPanEnd, scrollRef }) {
  const columnPanRef = useRef(null);
  const suppressColumnPanClickRef = useRef(false);
  const [columnPanAvailable, setColumnPanAvailable] = useState(false);

  // Returns the table scroller when the columns actually overflow, so
  // panning is a no-op on a wide window.
  function columnScroller() {
    const scroller = scrollRef.current;

    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) {
      return null;
    }

    return scroller;
  }

  // The pinned block's edge shadow and the pan's grabbing cursor are painted
  // on the scroller itself (see .is-scrolled-x and .is-panning in styles.css).
  // They are pure scroll and gesture state, so writing the class directly
  // keeps a pan from rebuilding the note rows or the header. The class is
  // also kept in sync from the scroller's scroll event, because a scroll can
  // arrive from a wheel, a trackpad or a keyboard pan without passing
  // through here.
  function syncColumnScroll(scroller = scrollRef.current) {
    scroller?.classList.toggle(
      "is-scrolled-x",
      isColumnPanShadowVisible(scroller.scrollLeft ?? 0),
    );
  }

  function scrollColumnsTo(scroller, left) {
    // Chromium animates the pan; jsdom (tests) has no scrollTo, so fall back
    // to a direct assignment there.
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ behavior: "smooth", left });
      return;
    }

    scroller.scrollLeft = left;
    syncColumnScroll(scroller);
  }

  function panColumnsBy(delta) {
    const scroller = columnScroller();

    if (!scroller) {
      return false;
    }

    scrollColumnsTo(
      scroller,
      clampColumnScrollLeft(
        scroller.scrollLeft,
        delta,
        scroller.scrollWidth - scroller.clientWidth,
      ),
    );
    return true;
  }

  function panColumnsToEdge(forward) {
    const scroller = columnScroller();

    if (!scroller) {
      return false;
    }

    scrollColumnsTo(scroller, forward ? scroller.scrollWidth : 0);
    return true;
  }

  function resetColumnScroll() {
    const scroller = scrollRef.current;

    if (scroller) {
      scroller.scrollLeft = 0;
      syncColumnScroll(scroller);
    }
  }

  function handleColumnPanPointerDown(event) {
    // Clear first so a missed pointerup cannot leave a stale pending pan
    // that would suppress focus on a later, unrelated press.
    columnPanRef.current = null;
    const scroller = columnScroller();

    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !scroller ||
      !isColumnPanTarget(event.target)
    ) {
      return;
    }

    columnPanRef.current = {
      active: false,
      pointerId: event.pointerId,
      startScrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
  }

  function handleColumnPanMouseDown(event) {
    // Pointerdown fires before mousedown and already armed the pan, so a
    // press that can start a pan must stay focus-neutral: cancelling the
    // press's default focus action keeps the active row's DOM focus, focus
    // memory, and highlight intact. The follow-up click is unaffected, so
    // ordinary clicks still fire; a completed pan swallows its own click.
    if (columnPanRef.current) {
      event.preventDefault();
    }
  }

  function handleColumnPanPointerMove(event) {
    const pan = columnPanRef.current;
    const scroller = scrollRef.current;

    if (!pan || !scroller || event.pointerId !== pan.pointerId) {
      return;
    }

    const deltaX = event.clientX - pan.startX;

    if (!pan.active) {
      if (Math.abs(deltaX) < COLUMN_PAN_THRESHOLD_PX) {
        return;
      }

      pan.active = true;
      scroller.classList.add("is-panning");

      if (typeof scroller.setPointerCapture === "function") {
        scroller.setPointerCapture(event.pointerId);
      }

      window.getSelection()?.removeAllRanges();
    }

    event.preventDefault();
    scroller.scrollLeft = columnPanScrollLeft({
      startScrollLeft: pan.startScrollLeft,
      startX: pan.startX,
      clientX: event.clientX,
      max: scroller.scrollWidth - scroller.clientWidth,
    });
    syncColumnScroll(scroller);
  }

  function handleColumnPanPointerEnd(event) {
    const pan = columnPanRef.current;

    if (
      !pan ||
      (event?.pointerId != null && event.pointerId !== pan.pointerId)
    ) {
      return;
    }

    if (pan.active) {
      // The drag finishes with a click on whatever was under the pointer;
      // swallow that one click so a pan ending on a row does not open the
      // note. The timer clears the flag if no click follows.
      suppressColumnPanClickRef.current = true;
      window.setTimeout(() => {
        suppressColumnPanClickRef.current = false;
      }, 0);
    }

    columnPanRef.current = null;
    // A pan captures the pointer to the scroller, so the row's mouseup may
    // never run. Let the screen reset any press flag it keeps.
    onPanEnd?.();
    scrollRef.current?.classList.remove("is-panning");
  }

  function handleColumnPanClickCapture(event) {
    if (!suppressColumnPanClickRef.current) {
      return;
    }

    suppressColumnPanClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // A window switch mid-pan never delivers pointerup to the scroller, and the
  // capture can outlive the gesture. End the pan on blur so the grabbing
  // cursor and the suppressed text selection cannot stick. The handler only
  // touches refs, so the first render's copy stays correct.
  useEffect(() => {
    function endPanOnBlur() {
      if (columnPanRef.current) {
        handleColumnPanPointerEnd();
      }
    }

    window.addEventListener("blur", endPanOnBlur);
    return () => window.removeEventListener("blur", endPanOnBlur);
    // The handler reads live refs; it must not be re-bound on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The scroller's content width is the sum of the rendered <col> widths, so
  // the columns only need re-checking when those widths change (a resize, a
  // column toggle, or the scrollbar's gutter) or when the scroller remounts
  // with the rows. Same overflow test as columnScroller(), so the footer only
  // offers the arrows when pressing them would actually move the table.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
    setColumnPanAvailable((current) =>
      current === overflows ? current : overflows,
    );
    // `measureDeps` is the caller's list of width-changing values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef, ...measureDeps]);

  return {
    columnPanAvailable,
    handleColumnPanClickCapture,
    handleColumnPanMouseDown,
    handleColumnPanPointerDown,
    handleColumnPanPointerEnd,
    handleColumnPanPointerMove,
    panColumnsBy,
    panColumnsToEdge,
    resetColumnScroll,
    scrollHandlers: {
      onClickCapture: handleColumnPanClickCapture,
      onLostPointerCapture: handleColumnPanPointerEnd,
      onMouseDown: handleColumnPanMouseDown,
      onPointerCancel: handleColumnPanPointerEnd,
      onPointerDown: handleColumnPanPointerDown,
      onPointerMove: handleColumnPanPointerMove,
      onPointerUp: handleColumnPanPointerEnd,
    },
    syncColumnScroll,
  };
}
