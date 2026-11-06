import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildNoteRowModel } from "../lib/noteRowModel.js";
import { marksForNote } from "../lib/noteView.js";
import { useColumnPan } from "../lib/useColumnPan.js";
import { allNotesDefaultSortKey } from "../lib/allNotesColumns.js";
import {
  cellClass,
  stickyCellAttributes,
} from "../lib/tableCells.jsx";
import {
  getTableColumn,
  lastStickyKey,
  stickyOffsets,
  tableColumnWidths,
} from "../lib/tableColumns.js";
import { isEditableElement } from "../lib/editableElement.js";
import { useTableFind } from "../lib/useTableFind.js";
import { ColumnPicker } from "./ColumnPicker.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { TableFilterBar } from "./TableFilterBar.jsx";
import { TableFindBar } from "./TableFindBar.jsx";
import { TableSurface } from "./TableSurface.jsx";

// Mirrors the Table screen's row rhythm and its 1200px table floor.
const rowHeightEstimate = 45;
const minTableWidth = 1200;
const tableGutterWidth = 14;

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
  const scrollRef = useRef(null);
  const filterBarRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
  const rowElementMapRef = useRef(new Map());
  const pendingRowFocusNoteIdRef = useRef(null);
  const lastActiveNoteIdRef = useRef(null);
  const previousSlideshowActiveRef = useRef(slideshowActive);
  const dragStateRef = useRef({ draggedNoteId: null, dropTarget: null });
  const rowHandlerImplRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(null);
  const [vScrollVisible, setVScrollVisible] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // The default order is Collection ascending even when the URL carries no
  // sort, so the header and footer name the order the rows are actually in.
  const effectiveSortKey = sortKey ?? allNotesDefaultSortKey;
  const sortLabel =
    effectiveSortKey === allNotesDefaultSortKey
      ? "Collection"
      : (getTableColumn(effectiveSortKey)?.label ?? "#");

  const columnWidths = useMemo(
    () =>
      tableColumnWidths(
        columns,
        Math.max(tableWidth ?? minTableWidth, minTableWidth),
        vScrollVisible ? tableGutterWidth : 0,
      ),
    [columns, tableWidth, vScrollVisible],
  );
  const lastStickyColumnKey = useMemo(() => lastStickyKey(columns), [columns]);
  const stickyLeftByColumn = useMemo(
    () => stickyOffsets(columns, columnWidths),
    [columnWidths, columns],
  );
  const totalColumnCount = columns.length + (vScrollVisible ? 1 : 0);

  const {
    columnPanAvailable,
    panColumnsBy,
    panColumnsToEdge,
    resetColumnScroll,
    scrollHandlers,
    syncColumnScroll,
  } = useColumnPan({
    measureDeps: [columnWidths, notes.length, vScrollVisible],
    scrollRef,
  });

  const find = useTableFind({
    allRows: allNotes,
    hasActiveFilters,
    onCloseFocus: (noteId) => {
      if (noteId != null && notes.some((note) => note.id === noteId)) {
        focusRowByNoteId(noteId);
      } else {
        focusTableAnchor();
      }
    },
    onRevealMatch: revealFindMatch,
    onSearchAll,
    rows: notes,
    searchColumns,
  });

  const rowVirtualizer = useVirtualizer({
    count: notes.length,
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => scrollRef.current,
    overscan: 4,
    useFlushSync: false,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length
    ? rowVirtualizer.getTotalSize() -
      virtualRows[virtualRows.length - 1].end
    : 0;

  const rowModelsByNoteId = useMemo(() => {
    const map = new Map();

    for (const note of notes) {
      map.set(
        note.id,
        buildNoteRowModel({
          columnWidths,
          columns,
          lastStickyColumnKey,
          marks: conditions.length
            ? marksForNote(note, conditions, searchColumns)
            : null,
          note,
          stickyLeftByColumn,
        }),
      );
    }

    return map;
  }, [
    columnWidths,
    columns,
    conditions,
    lastStickyColumnKey,
    notes,
    searchColumns,
    stickyLeftByColumn,
  ]);

  const selectedIdSet = useMemo(() => new Set(), []);

  // The table's measured width is the scroller's width, not the table's own
  // rendered width: fixed-layout tables refuse to shrink below their columns.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;

    if (!scroller) {
      return undefined;
    }

    const measure = () => {
      const nextWidth = scroller.getBoundingClientRect().width;
      setTableWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

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

  function focusTableAnchor() {
    tableFocusAnchorRef.current?.focus({ preventScroll: true });
  }

  function focusRowByNoteId(noteId) {
    if (noteId == null) {
      return;
    }

    const element = rowElementMapRef.current.get(noteId);

    if (element) {
      element.focus({ preventScroll: true });
      lastActiveNoteIdRef.current = noteId;
      setActiveNoteId(noteId);
      ensureRowVisible(element);
      return;
    }

    const index = notes.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    pendingRowFocusNoteIdRef.current = noteId;
    lastActiveNoteIdRef.current = noteId;
    setActiveNoteId(noteId);
    rowVirtualizer.scrollToIndex(index, { align: "auto" });
  }

  function clearRowCursor() {
    setActiveNoteId(null);
  }

  function openNote(note) {
    lastActiveNoteIdRef.current = note.id;
    setActiveNoteId(note.id);
    onOpenNote(note);
  }

  function registerRowElement(noteId, element) {
    if (!element) {
      rowElementMapRef.current.delete(noteId);
      return;
    }

    rowElementMapRef.current.set(noteId, element);

    if (pendingRowFocusNoteIdRef.current === noteId) {
      pendingRowFocusNoteIdRef.current = null;
      element.focus({ preventScroll: true });
      ensureRowVisible(element);
    } else if (
      activeNoteId === noteId &&
      document.activeElement === document.body
    ) {
      // The active row was scrolled out of the virtualized window and has now
      // remounted: reclaim focus without scrolling, since the user put it here.
      element.focus({ preventScroll: true });
    }
  }

  function revealFindMatch(noteId) {
    const index = notes.findIndex((note) => note.id === noteId);

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

  function moveRowFocus(offset) {
    if (!notes.length) {
      return;
    }

    const currentIndex = notes.findIndex((note) => note.id === activeNoteId);
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      notes.length - 1,
    );

    focusRowByNoteId(notes[nextIndex].id);
  }

  function pageNotes(direction) {
    if (!notes.length) {
      return;
    }

    const scroller = scrollRef.current;
    const headerHeight = scroller?.querySelector("thead")?.offsetHeight ?? 0;
    const pageSize = Math.max(
      1,
      Math.floor(((scroller?.clientHeight ?? 0) - headerHeight) / rowHeightEstimate),
    );
    const currentIndex = notes.findIndex((note) => note.id === activeNoteId);
    const firstVisibleIndex = rowVirtualizer.getVirtualItems()[0]?.index ?? 0;
    const baseIndex =
      currentIndex >= 0
        ? currentIndex
        : Math.min(Math.max(firstVisibleIndex, 0), notes.length - 1);
    const nextIndex = Math.min(
      Math.max(baseIndex + direction * pageSize, 0),
      notes.length - 1,
    );

    focusRowByNoteId(notes[nextIndex].id);
  }

  function focusFirstNote() {
    if (notes[0]) {
      focusRowByNoteId(notes[0].id);
    }
  }

  function focusLastNote() {
    if (notes.length) {
      focusRowByNoteId(notes[notes.length - 1].id);
    }
  }

  function tableCellAttributes(column) {
    return stickyCellAttributes(column, cellClass(column), {
      lastStickyColumnKey,
      stickyLeftByColumn,
    });
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
    onRowElement: registerRowElement,
    onRowFocus: (note) => {
      lastActiveNoteIdRef.current = note.id;
      setActiveNoteId(note.id);
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
    // first row.
    pendingRowFocusNoteIdRef.current = null;
    clearRowCursor();
  }, [conditions, sortDirection, sortKey, visibleColumnKeys]);

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

      clearRowCursor();
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

    const noteId = lastActiveNoteIdRef.current;

    if (noteId == null || !notes.some((note) => note.id === noteId)) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      focusRowByNoteId(noteId);
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
        if (activeNoteId != null) {
          event.preventDefault();
          clearRowCursor();
          focusTableAnchor();
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
        moveRowFocus(1);
        return;
      }

      if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "k")) {
        event.preventDefault();
        moveRowFocus(-1);
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        pageNotes(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();

        if (event.key === "Home") {
          focusFirstNote();
        } else {
          focusLastNote();
        }
        return;
      }

      if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "l") {
        if (panColumnsBy(200)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "h") {
        if (panColumnsBy(-200)) {
          event.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeNoteId,
    find.handleShortcut,
    hasActiveFilters,
    notes,
    onClearFilters,
    showShortcutsHelp,
    slideshowActive,
  ]);

  const sortStatus = sortKey
    ? ` · sorted by ${sortLabel} ${sortDirection === "asc" ? "ascending" : "descending"}`
    : "";
  const summary = `Showing ${notes.length} of ${noteCountLabel(totalCount)} across ${collectionCountLabel(collectionCount)}${sortStatus}${find.status}`;

  const emptyRow =
    notes.length === 0 ? (
      <tr className="table-empty-row">
        <td className="table-empty-cell" colSpan={totalColumnCount}>
          <div className="table-empty-frame">{emptyContent}</div>
        </td>
      </tr>
    ) : null;

  return (
    <>
      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      <div className="table-shell">
        <span
          aria-hidden="true"
          className="table-focus-anchor"
          ref={tableFocusAnchorRef}
          tabIndex={-1}
        />
        {showToolbar ? (
          <div className="table-rail">
            <TableFilterBar
              conditions={conditions}
              defaultField="all"
              hasRows={notes.length > 0}
              onConditionsChange={onConditionsChange}
              onFirstRow={focusFirstNote}
              ref={filterBarRef}
              searchColumns={searchColumns}
              tagNames={tagNames}
            />
            <div className="table-rail-actions">
              <select
                aria-label="Collection"
                className="all-notes-collection-picker"
                onChange={(event) => onCollectionChange(event.target.value)}
                value={selectedCollectionId ?? ""}
              >
                {collectionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                aria-label="Find in this view"
                className="button"
                data-shortcut="Ctrl+F"
                onClick={find.open}
                title="Find in this view (Ctrl/Cmd+F)"
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  focusable="false"
                  height="15"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.9"
                  viewBox="0 0 24 24"
                  width="15"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <span className="table-find-toggle-label">Find</span>
              </button>
              {canResetView ? (
                <button
                  className="button"
                  onClick={onResetView}
                  title="Clears the collection scope, filters and sort — keeps your columns"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    focusable="false"
                    height="15"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.8"
                    viewBox="0 0 24 24"
                    width="15"
                  >
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  Reset view
                </button>
              ) : null}
              <ColumnPicker
                columns={hideableColumns}
                disabledColumnKey={lastVisibleDataColumnKey}
                onToggle={onToggleColumn}
                visibleColumnKeys={visibleColumnKeys}
              />
            </div>
          </div>
        ) : null}

        <TableSurface
          activeNoteId={activeNoteId}
          allVisibleSelected={false}
          ariaLabel="All notes table"
          bottomSpacerHeight={bottomSpacerHeight}
          canMove={false}
          canReorder={false}
          columnWidths={columnWidths}
          columns={columns}
          dragStateRef={dragStateRef}
          emptyContent={emptyRow}
          emptyView={notes.length === 0}
          findBar={
            find.isOpen ? <TableFindBar {...find.barProps} /> : null
          }
          findCurrentNoteId={find.currentMatchId}
          findMarksByNoteId={find.marksByNoteId}
          gutterWidth={tableGutterWidth}
          handlers={rowHandlers}
          loading={false}
          notes={notes}
          onFirstRow={focusFirstNote}
          onLastRow={focusLastNote}
          onPage={pageNotes}
          onReorder={() => {}}
          onScroll={() => syncColumnScroll()}
          onVisibleChange={setVScrollVisible}
          reorderRail={false}
          rowCount={notes.length}
          rowElementFor={(noteId) => rowElementMapRef.current.get(noteId)}
          rowHeight={rowHeightEstimate}
          rowModelsByNoteId={rowModelsByNoteId}
          scrollHandlers={scrollHandlers}
          scrollRef={scrollRef}
          selectedIdSet={selectedIdSet}
          showGutter={vScrollVisible}
          sortDirection={sortDirection}
          sortKey={effectiveSortKey}
          tableCellAttributes={tableCellAttributes}
          toggleAllVisible={() => {}}
          toggleSort={onSort}
          topSpacerHeight={topSpacerHeight}
          totalColumnCount={totalColumnCount}
          virtualRows={virtualRows}
        />
      </div>
      <div className="table-footer-hint">
        <span
          aria-atomic="true"
          aria-live="polite"
          className="table-footer-summary"
        >
          {summary}
        </span>
        <span className="table-footer-right">
          <span className="table-footer-keys">
            {notes.length ? (
              <span className="table-footer-segment">
                <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to browse
              </span>
            ) : null}
            {columnPanAvailable ? (
              <span className="table-footer-segment">
                <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to pan
              </span>
            ) : null}
            <span className="table-footer-segment">
              <kbd>?</kbd> shortcuts
            </span>
          </span>
        </span>
      </div>
    </>
  );
}
