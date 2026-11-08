import { useEffect, useMemo, useRef, useState } from "react";
import { allNotesDefaultSortKey } from "../lib/allNotesColumns.js";
import { isEditableElement } from "../lib/editableElement.js";
import { useNotesTable } from "../lib/useNotesTable.js";
import { getTableColumn } from "../lib/tableColumns.js";
import { NotesTableView } from "./NotesTableView.jsx";
import { SelectField } from "./SelectField.jsx";

function noteCountLabel(count) {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

function collectionCountLabel(count) {
  return `${count} ${count === 1 ? "collection" : "collections"}`;
}

function isInteractiveTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest("a, button, select, input, label, textarea"),
  );
}

export function AllNotesTable({
  allNotes,
  canResetView,
  collectionCount,
  collectionOptions,
  columns,
  conditions,
  emptyContent,
  hasActiveFilters,
  hideableColumns,
  lastVisibleDataColumnKey,
  notes,
  onApplyTagFilter,
  onClearFilters,
  onCollectionChange,
  onConditionsChange,
  onOpenNote,
  onResetView,
  onSearchAll,
  onSort,
  onToggleColumn,
  paintedConditions: paintedConditionsProp,
  rowsPending = false,
  searchColumns,
  selectedCollectionId,
  showToolbar = true,
  slideshowActive,
  sortDirection,
  sortKey,
  tagNames,
  totalCount,
  visibleColumnKeys,
}) {
  // The filter bar keeps the urgent conditions; the rows and their marks land
  // one deferred step later. Without a deferred copy the two are the same.
  const paintedConditions = paintedConditionsProp ?? conditions;
  const filterBarRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
  const previousSlideshowActiveRef = useRef(slideshowActive);
  const dragStateRef = useRef({ draggedNoteId: null, dropTarget: null });
  const rowHandlerImplRef = useRef(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const table = useNotesTable({
    allRows: allNotes,
    columns,
    conditions: paintedConditions,
    hasActiveFilters,
    onFocusAnchor: () =>
      tableFocusAnchorRef.current?.focus({ preventScroll: true }),
    onSearchAll,
    rows: notes,
    searchColumns,
  });
  const { cursor, find } = table;

  const effectiveSortKey = sortKey ?? allNotesDefaultSortKey;
  const sortLabel =
    effectiveSortKey === allNotesDefaultSortKey
      ? "Collection"
      : (getTableColumn(effectiveSortKey)?.label ?? "#");

  function openNote(note) {
    cursor.markActiveNote(note.id);
    onOpenNote(note);
  }

  rowHandlerImplRef.current = {
    onApplyTagFilter,
    onOpenNote: openNote,
    onRowClick: (note, event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }

      openNote(note);
    },
    onRowElement: cursor.registerRowElement,
    onRowFocus: (note) => {
      cursor.markActiveNote(note.id);
    },
    onRowKeyDown: (note, event) => {
      if (event.target !== event.currentTarget) {
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        openNote(note);
      }
    },
  };

  // One stable handlers object keeps the memoized rows from re-rendering when
  // only find or the cursor changed; every member reads the latest render
  // through the ref above.
  const rowHandlers = useMemo(() => {
    const invoke = (name) => (...args) =>
      rowHandlerImplRef.current?.[name]?.(...args);
    const noop = () => {};

    return {
      onActionsRef: noop,
      onApplyTagFilter: invoke("onApplyTagFilter"),
      onCopyNote: noop,
      onDeleteNote: noop,
      onEditNote: noop,
      onInsertNoteAfter: noop,
      onMoveNote: noop,
      onOpenNote: invoke("onOpenNote"),
      onReorderNote: noop,
      onRowBlur: noop,
      onRowClick: invoke("onRowClick"),
      onRowElement: invoke("onRowElement"),
      onRowFocus: invoke("onRowFocus"),
      onRowKeyDown: invoke("onRowKeyDown"),
      onRowMouseDown: noop,
      onRowMouseUp: noop,
      onThumbElement: noop,
      onThumbEnter: noop,
      onThumbLeave: noop,
      onToggleSelection: noop,
    };
  }, []);

  useEffect(() => {
    // A filter, sort or column change produces a new row order: drop a
    // not-yet-landed virtualized focus so the next arrow starts from the new
    // first row. The painted conditions land with the rows they mark.
    cursor.cancelPendingFocus();
    cursor.clearRowCursor();
  }, [paintedConditions, sortDirection, sortKey, visibleColumnKeys]);

  useEffect(() => {
    // Focus moving out of a row and the table's own chrome drops the painted
    // cursor. The sidebar keeps it lit while the rail is open, matching the
    // collection table.
    function handleFocusIn(event) {
      if (!(event.target instanceof Element)) {
        return;
      }

      if (
        event.target.closest("tr.table-row-link") ||
        event.target.closest(".table-find-bar") ||
        event.target.closest("#app-sidebar") ||
        event.target.closest(".table-rail")
      ) {
        return;
      }

      if (event.target === document.body) {
        return;
      }

      cursor.clearRowCursor();
    }

    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, []);

  useEffect(() => {
    // Returning from the slideshow hands the cursor back to the row that
    // opened it, so Esc lands on the All notes page exactly where it left.
    const wasActive = previousSlideshowActiveRef.current;
    previousSlideshowActiveRef.current = slideshowActive;

    if (!wasActive || slideshowActive) {
      return undefined;
    }

    const noteId = cursor.lastActiveNoteIdRef.current;

    if (noteId == null || !notes.some((note) => note.id === noteId)) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      cursor.focusRowByNoteId(noteId);
    });

    return () => window.cancelAnimationFrame(frameId);
    // `focusRowByNoteId` reads the painted list of the render it runs in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, slideshowActive]);

  useEffect(() => {
    function overlayOwnsKeys(target) {
      return (
        (target instanceof Element &&
          Boolean(
            target.closest(
              "[role='dialog'], [role='menu'], [role='listbox'], .shortcuts-panel",
            ),
          )) ||
        Boolean(document.querySelector("[role='menu'], [role='listbox']"))
      );
    }

    function handleKeyDown(event) {
      if (slideshowActive || showShortcutsHelp) {
        return;
      }

      if (overlayOwnsKeys(event.target)) {
        return;
      }

      if (find.handleShortcut(event)) {
        return;
      }

      if (
        event.target instanceof Element &&
        event.target.closest("#app-sidebar")
      ) {
        return;
      }

      const editable = isEditableElement(event.target);

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "?" && !editable) {
        event.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }

      if (event.key === "/" && !editable) {
        event.preventDefault();
        filterBarRef.current?.focus();
        return;
      }

      if (editable) {
        return;
      }

      if (event.key === "Escape") {
        if (cursor.activeNoteId != null) {
          event.preventDefault();
          cursor.clearRowCursor();
          tableFocusAnchorRef.current?.focus({ preventScroll: true });
          return;
        }

        if (hasActiveFilters) {
          event.preventDefault();
          onClearFilters();
        }
        return;
      }

      if (!event.shiftKey && (event.key === "ArrowDown" || event.key === "j")) {
        event.preventDefault();
        cursor.moveRowFocus(1, {
          onBeforeFirst: () => filterBarRef.current?.focus(),
        });
        return;
      }

      if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "k")) {
        event.preventDefault();
        cursor.moveRowFocus(-1, {
          onBeforeFirst: () => filterBarRef.current?.focus(),
        });
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        cursor.pageRows(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();

        if (event.key === "Home") {
          cursor.focusFirstRow();
        } else {
          cursor.focusLastRow();
        }
        return;
      }

      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "l") {
        if (table.columnPan.panColumnsBy(200)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "h") {
        if (table.columnPan.panColumnsBy(-200)) {
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cursor,
    find,
    hasActiveFilters,
    onClearFilters,
    showShortcutsHelp,
    slideshowActive,
    table.columnPan,
  ]);

  const sortStatus = sortKey
    ? ` · sorted by ${sortLabel} ${sortDirection === "asc" ? "ascending" : "descending"}`
    : "";
  const summary = `Showing ${notes.length} of ${noteCountLabel(totalCount)} across ${collectionCountLabel(collectionCount)}${sortStatus}${find.status}`;

  const selectedIdSet = useMemo(() => new Set(), []);
  const collectionPicker = (
    <SelectField
      ariaLabel="Collection"
      onChange={onCollectionChange}
      options={collectionOptions}
      value={selectedCollectionId ?? ""}
      wrapperClassName="all-notes-collection-picker"
    />
  );

  return (
    <NotesTableView
      ariaLabel="All notes table"
      canResetView={canResetView}
      columns={columns}
      emptyContent={emptyContent}
      emptyView={notes.length === 0 && !rowsPending}
      filterBar={{
        conditions,
        defaultField: "all",
        hasRows: notes.length > 0,
        onConditionsChange,
        searchColumns,
        tagNames,
      }}
      filterBarRef={filterBarRef}
      focusAnchorRef={tableFocusAnchorRef}
      footerSummary={summary}
      handlers={rowHandlers}
      hideableColumns={hideableColumns}
      lastVisibleDataColumnKey={lastVisibleDataColumnKey}
      onCloseShortcuts={() => setShowShortcutsHelp(false)}
      onResetView={onResetView}
      onToggleColumn={onToggleColumn}
      railStart={collectionPicker}
      resetTitle="Clears the collection scope, filters and sort — keeps your columns"
      rows={notes}
      showShortcutsHelp={showShortcutsHelp}
      showToolbar={showToolbar}
      surface={{
        allVisibleSelected: false,
        ariaBusy: rowsPending,
        canMove: false,
        canReorder: false,
        dragStateRef,
        loading: false,
        onReorder: () => {},
        reorderRail: false,
        selectedIdSet,
        sortDirection,
        sortKey: effectiveSortKey,
        toggleAllVisible: () => {},
        toggleSort: onSort,
      }}
      table={table}
      visibleColumnKeys={visibleColumnKeys}
    />
  );
}
