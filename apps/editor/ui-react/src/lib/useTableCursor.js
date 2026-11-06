import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { shouldHandOffToFilters } from "./filterFocusMemory.js";

// The virtualized row cursor both note tables share: the scroller, the
// virtualizer window, the row-element registry, pending focus for rows that
// have not mounted yet, and the move/page/reveal helpers. Screen-specific
// focus behaviour arrives as `after` callbacks so the cursor stays one
// mechanism.
export function useTableCursor({
  indexRows = null,
  overscan = 4,
  rowHeight = 45,
  rows,
}) {
  const scrollRef = useRef(null);
  const rowElementMapRef = useRef(new Map());
  const focusedRowIdRef = useRef(null);
  const lastActiveNoteIdRef = useRef(null);
  const pendingFocusRef = useRef(null);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const navigationRows = indexRows ?? rows;

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    // Rows are one line and never wrap, so their height is fixed. Without
    // dynamic measurement the offsets are pure arithmetic, which lets the
    // virtualizer skip the synchronous render on every scroll tick.
    estimateSize: () => rowHeight,
    getScrollElement: () => scrollRef.current,
    overscan,
    useFlushSync: false,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  function ensureRowVisible(element) {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const headerBottom =
      scroller.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
    const scrollerBox = scroller.getBoundingClientRect();
    const rowBox = element.getBoundingClientRect();

    if (rowBox.top < headerBottom) {
      scroller.scrollTop -= headerBottom - rowBox.top;
    } else if (rowBox.bottom > scrollerBox.bottom) {
      scroller.scrollTop += rowBox.bottom - scrollerBox.bottom;
    }
  }

  function pinRowToTop(element) {
    const scroller = scrollRef.current;

    if (!scroller) {
      return;
    }

    const headerBottom =
      scroller.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
    scroller.scrollTop += element.getBoundingClientRect().top - headerBottom;
  }

  function revealElement(element, pinToTop) {
    if (pinToTop) {
      pinRowToTop(element);
    } else {
      ensureRowVisible(element);
    }
  }

  function markActiveNote(noteId) {
    lastActiveNoteIdRef.current = noteId;
    setActiveNoteId(noteId);
  }

  function clearRowCursor() {
    // The keyboard cursor is focus memory plus paint: both must drop together.
    focusedRowIdRef.current = null;
    setActiveNoteId(null);
  }

  function cancelPendingFocus() {
    pendingFocusRef.current = null;
  }

  function requestFocus(noteId, { after, pinToTop = false, selector = null } = {}) {
    if (noteId == null) {
      return;
    }

    const element = rowElementMapRef.current.get(noteId);

    if (element) {
      const control = selector ? element.querySelector(selector) : element;

      (control ?? element).focus({ preventScroll: true });
      focusedRowIdRef.current = noteId;
      lastActiveNoteIdRef.current = noteId;
      setActiveNoteId(noteId);
      revealElement(element, pinToTop);
      after?.();
      return;
    }

    const index = navigationRows.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    pendingFocusRef.current = { after, noteId, pinToTop, selector };
    lastActiveNoteIdRef.current = noteId;
    setActiveNoteId(noteId);
    rowVirtualizer.scrollToIndex(index, {
      align: pinToTop ? "start" : "auto",
    });
  }

  function focusRowByNoteId(noteId, options = {}) {
    requestFocus(noteId, options);
  }

  function focusFirstRow() {
    if (navigationRows[0]) {
      focusRowByNoteId(navigationRows[0].id);
    }
  }

  function focusLastRow() {
    if (navigationRows.length) {
      focusRowByNoteId(navigationRows[navigationRows.length - 1].id);
    }
  }

  function registerRowElement(noteId, element) {
    if (!element) {
      rowElementMapRef.current.delete(noteId);
      return;
    }

    rowElementMapRef.current.set(noteId, element);

    const pending = pendingFocusRef.current;

    if (pending?.noteId === noteId) {
      pendingFocusRef.current = null;
      const control = pending.selector
        ? element.querySelector(pending.selector)
        : element;

      (control ?? element).focus({ preventScroll: true });
      focusedRowIdRef.current = noteId;
      lastActiveNoteIdRef.current = noteId;
      setActiveNoteId(noteId);
      revealElement(element, pending.pinToTop);
      pending.after?.();
      return;
    }

    if (
      focusedRowIdRef.current === noteId &&
      document.activeElement === document.body
    ) {
      // The active row was scrolled out of the virtualized window (unmounting
      // drops focus to <body> with no blur event) and has now remounted:
      // reclaim focus without scrolling, since the user put it here.
      element.focus({ preventScroll: true });
    }
  }

  function moveRowFocus(offset, { onAfterFocus, onBeforeFirst } = {}) {
    if (!navigationRows.length) {
      return null;
    }

    const currentIndex = navigationRows.findIndex(
      (note) => note.id === focusedRowIdRef.current,
    );
    const currentElement =
      currentIndex === 0
        ? (rowElementMapRef.current.get(focusedRowIdRef.current) ?? null)
        : null;

    if (
      shouldHandOffToFilters({
        activeElement: document.activeElement,
        currentIndex,
        offset,
        rowElement: currentElement,
      })
    ) {
      clearRowCursor();
      onBeforeFirst?.();
      return null;
    }

    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      navigationRows.length - 1,
    );
    const targetId = navigationRows[nextIndex].id;

    focusRowByNoteId(targetId, {
      after: onAfterFocus ? () => onAfterFocus(targetId) : undefined,
    });
    return targetId;
  }

  function pageRows(direction, { onAfterFocus } = {}) {
    const scroller = scrollRef.current;

    if (!scroller || !navigationRows.length) {
      return null;
    }

    const headerHeight = scroller.querySelector("thead")?.offsetHeight ?? 0;
    const pageSize = Math.max(
      1,
      Math.floor((scroller.clientHeight - headerHeight) / rowHeight),
    );
    const currentIndex = navigationRows.findIndex(
      (note) => note.id === focusedRowIdRef.current,
    );
    // No focus yet (fresh load, Esc to the anchor): anchor on the current
    // first visible row so the first press already jumps a full page.
    const firstVisibleIndex = rowVirtualizer.getVirtualItems()[0]?.index ?? 0;
    const baseIndex =
      currentIndex >= 0
        ? currentIndex
        : Math.min(Math.max(firstVisibleIndex, 0), navigationRows.length - 1);
    const targetIndex = Math.min(
      Math.max(baseIndex + direction * pageSize, 0),
      navigationRows.length - 1,
    );
    const target = navigationRows[targetIndex];

    // Focus drives the scrolling (scrollToIndex for virtualized rows, top-pin
    // for mounted ones) so the target lands as the first row below the sticky
    // header.
    if (target) {
      focusRowByNoteId(target.id, {
        after: onAfterFocus ? () => onAfterFocus(target.id) : undefined,
        pinToTop: true,
      });
    }

    return target?.id ?? null;
  }

  function revealRow(noteId) {
    const index = rows.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    const element = rowElementMapRef.current.get(noteId);

    if (element) {
      ensureRowVisible(element);
      return;
    }

    rowVirtualizer.scrollToIndex(index, { align: "center" });
  }

  return {
    activeNoteId,
    bottomSpacerHeight,
    cancelPendingFocus,
    clearRowCursor,
    ensureRowVisible,
    focusFirstRow,
    focusLastRow,
    focusRowByNoteId,
    focusedRowIdRef,
    lastActiveNoteIdRef,
    markActiveNote,
    moveRowFocus,
    pageRows,
    pinRowToTop,
    registerRowElement,
    requestFocus,
    revealRow,
    rowElementMapRef,
    rowVirtualizer,
    scrollRef,
    setActiveNoteId,
    topSpacerHeight,
    virtualRows,
  };
}
