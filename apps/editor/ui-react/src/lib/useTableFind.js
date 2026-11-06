import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marksForNote } from "./noteView.js";
import { matchesSearchQuery } from "./tableColumns.js";

// Find is a cursor over the painted view, not a filter: it owns an open flag,
// a deferred query, the matching notes and the current match. Both the Table
// screen and the All notes screen use this one implementation; only the rows
// it walks and the wider scope for "Search all" differ.
export function useTableFind({
  allRows,
  hasActiveFilters = false,
  onCloseFocus,
  onRevealMatch,
  onSearchAll,
  resetKey,
  rows,
  searchColumns,
}) {
  const inputRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [currentId, setCurrentId] = useState(null);

  // Defer the query like the painted view: typing must not rebuild every row
  // model or the virtualizer in the urgent render.
  const deferredQuery = useDeferredValue(query);
  const queryActive = isOpen && deferredQuery.trim().length > 0;
  const pending = isOpen && query.trim() !== deferredQuery.trim();
  const condition = useMemo(
    () => ({ field: "all", negated: false, value: deferredQuery }),
    [deferredQuery],
  );
  const matches = useMemo(() => {
    if (!queryActive) {
      return [];
    }

    return rows.filter((note) =>
      matchesSearchQuery(note, condition.value, searchColumns),
    );
  }, [condition, queryActive, rows, searchColumns]);

  const currentPosition = matches.findIndex((note) => note.id === currentId);
  const currentIndex = matches.length ? Math.max(currentPosition, 0) : -1;
  const currentMatchId =
    currentIndex >= 0 ? matches[currentIndex].id : null;

  // Keep the marks apart from the row models: an unmatchable row keeps its
  // model and identity, so typing in find only repaints the marks that changed.
  const marksByNoteId = useMemo(() => {
    const map = new Map();

    for (const note of matches) {
      map.set(
        note.id,
        marksForNote(note, [condition], searchColumns, { normalized: true }),
      );
    }

    return map;
  }, [condition, matches, searchColumns]);

  // The fallback only makes sense when clearing the filters would reveal a
  // match. The wider scope is a parameter because the two screens clear to
  // different lists.
  const canSearchAll = useMemo(() => {
    if (!hasActiveFilters || !queryActive || matches.length) {
      return false;
    }

    return allRows.some((note) =>
      matchesSearchQuery(note, condition.value, searchColumns),
    );
  }, [
    allRows,
    condition,
    hasActiveFilters,
    matches.length,
    queryActive,
    searchColumns,
  ]);

  function reset() {
    setQuery("");
    setCurrentId(null);
  }

  function focusInput() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function open() {
    if (isOpen) {
      // A second Ctrl/Cmd+F is "find again": keep the query and let the
      // collector replace or step it from the input.
      focusInput();
      return;
    }

    setIsOpen(true);
    reset();
  }

  function close() {
    const noteId = currentMatchId;

    setIsOpen(false);
    reset();

    // Hand focus to the row find was last on, or to the table anchor when
    // there is no row to land on. The screen owns that focus target because
    // it owns the table's anchor and cursor.
    onCloseFocus?.(noteId);
  }

  function step(direction) {
    if (matches.length < 2) {
      return;
    }

    const from = currentIndex >= 0 ? currentIndex : 0;
    const next = (from + direction + matches.length) % matches.length;

    setCurrentId(matches[next].id);
  }

  function searchAll() {
    // The fallback deliberately changes the view: the screen clears whatever
    // hid the match, keeps the query, and lets the reconcile effect land on
    // the first match. Focus returns to the bar at once.
    onSearchAll?.();
    setCurrentId(null);
    focusInput();
  }

  // The window key handler re-subscribes on many unrelated state changes, so
  // keep this stable and read the latest render through the ref.
  const shortcutImplRef = useRef(null);
  shortcutImplRef.current = { close, isOpen, open, step };

  const handleShortcut = useCallback((event) => {
    const impl = shortcutImplRef.current;

    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      impl.open();
      return true;
    }

    // F3 / Shift+F3 walk the matches without moving focus out of the input.
    if (event.key === "F3" && impl.isOpen) {
      event.preventDefault();
      impl.step(event.shiftKey ? -1 : 1);
      return true;
    }

    // Find closes before any other Escape level.
    if (event.key === "Escape" && impl.isOpen) {
      event.preventDefault();
      impl.close();
      return true;
    }

    return false;
  }, []);

  useEffect(() => {
    // Keep the stored current match honest: a filter, sort or column change
    // can remove it, in which case find falls back to the first match.
    if (!isOpen) {
      return;
    }

    if (!matches.length) {
      setCurrentId(null);
      return;
    }

    if (!matches.some((note) => note.id === currentId)) {
      setCurrentId(matches[0].id);
    }
  }, [currentId, isOpen, matches]);

  useEffect(() => {
    // Reveal the current match after it lands. Focus stays in the input, so no
    // row cursor is painted and typing is never interrupted.
    if (!isOpen || currentMatchId == null) {
      return;
    }

    onRevealMatch?.(currentMatchId);
    // The index is a dependency because a filter or sort change can re-order
    // the matches while the current note stays the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, currentMatchId, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isOpen]);

  useEffect(() => {
    // Find belongs to one view. The Table screen resets it on a collection
    // switch; All notes passes no key and keeps it across scope changes.
    if (resetKey === undefined) {
      return;
    }

    setIsOpen(false);
    reset();
  }, [resetKey]);

  const status = queryActive
    ? ` · Find ${
        matches.length
          ? `${currentIndex + 1} of ${matches.length}`
          : "no matches"
      }`
    : "";

  return {
    barProps: {
      canSearchAll,
      currentIndex,
      filtersActive: hasActiveFilters,
      inputRef,
      matchCount: matches.length,
      onClose: close,
      onQueryChange: setQuery,
      onSearchAll: searchAll,
      onStep: step,
      pending,
      query,
    },
    canSearchAll,
    close,
    currentIndex,
    currentMatchId,
    handleShortcut,
    inputRef,
    isOpen,
    marksByNoteId,
    matches,
    open,
    pending,
    query,
    queryActive,
    searchAll,
    setQuery,
    status,
    step,
  };
}
