import { useLayoutEffect, useMemo, useState } from "react";
import { buildNoteRowModel } from "./noteRowModel.js";
import { marksForNote } from "./noteView.js";
import { cellClass, stickyCellAttributes } from "./tableCells.jsx";
import {
  lastStickyKey,
  stickyOffsets,
  tableColumnWidths,
} from "./tableColumns.js";
import { useColumnPan } from "./useColumnPan.js";
import { useTableCursor } from "./useTableCursor.js";
import { useTableFind } from "./useTableFind.js";

const minTableWidth = 1200;
const tableGutterWidth = 14;

// The controller both note tables share: the virtualized cursor, find, column
// geometry, the pan gesture and the row models. The screen supplies the rows,
// the visible columns and the focus/search callbacks; the module owns the rest.
export function useNotesTable({
  allRows,
  columns,
  conditions,
  hasActiveFilters,
  indexRows = null,
  measureDeps = [],
  onFocusAnchor,
  onPanEnd,
  onSearchAll,
  resetKey,
  rows,
  searchColumns,
}) {
  const cursor = useTableCursor({ indexRows, rows });
  const [tableWidth, setTableWidth] = useState(null);
  const [vScrollVisible, setVScrollVisible] = useState(false);
  const focusRows = indexRows ?? rows;

  const find = useTableFind({
    allRows,
    hasActiveFilters,
    onCloseFocus: (noteId) => {
      if (noteId != null && focusRows.some((note) => note.id === noteId)) {
        cursor.focusRowByNoteId(noteId);
      } else {
        onFocusAnchor?.();
      }
    },
    onRevealMatch: cursor.revealRow,
    onSearchAll,
    resetKey,
    rows,
    searchColumns,
  });

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

  const columnPan = useColumnPan({
    measureDeps: [columnWidths, rows.length, vScrollVisible],
    onPanEnd,
    scrollRef: cursor.scrollRef,
  });

  // The data columns need the space the table can occupy, not the table's own
  // rendered width: once the columns are wide, a fixed-layout table refuses to
  // shrink below their total.
  useLayoutEffect(() => {
    const scroller = cursor.scrollRef.current;

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
    // `measureDeps` is the caller's list of values that remount the scroller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor.scrollRef, ...measureDeps]);

  // The lazy model cache answers by note id, so it needs an id lookup. That
  // one pass is cheap next to a row model and survives a geometry change.
  const notesById = useMemo(
    () => new Map(rows.map((note) => [note.id, note])),
    [rows],
  );

  // Per-note row models are built on demand, when a row first paints, and then
  // cached for the life of this list and geometry. Building all N up front was
  // O(N) on every filter or sort even though the virtualizer paints only the
  // window; the cache keeps each model's identity stable across scroll, so a
  // row that stays in the window does not re-render.
  const rowModelsByNoteId = useMemo(() => {
    const models = new Map();

    return {
      get(noteId) {
        const cached = models.get(noteId);

        if (cached) {
          return cached;
        }

        const note = notesById.get(noteId);

        if (!note) {
          return undefined;
        }

        const model = buildNoteRowModel({
          columnWidths,
          columns,
          lastStickyColumnKey,
          marks: conditions.length
            ? marksForNote(note, conditions, searchColumns)
            : null,
          note,
          stickyLeftByColumn,
        });

        models.set(noteId, model);
        return model;
      },
    };
  }, [
    columnWidths,
    columns,
    conditions,
    lastStickyColumnKey,
    notesById,
    searchColumns,
    stickyLeftByColumn,
  ]);

  function tableCellAttributes(column) {
    return stickyCellAttributes(column, cellClass(column), {
      lastStickyColumnKey,
      stickyLeftByColumn,
    });
  }

  return {
    columnPan,
    columnWidths,
    cursor,
    find,
    rowModelsByNoteId,
    setVScrollVisible,
    tableCellAttributes,
    totalColumnCount,
    vScrollVisible,
  };
}
