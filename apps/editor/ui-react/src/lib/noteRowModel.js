import {
  cellClass,
  noteThumbnailPath,
  stickyCellClass,
  stickyCellStyle,
} from "./tableCells.jsx";
import { tagsColumnKey } from "./tableColumns.js";
import { computeVisibleTagPlan } from "./tagChipPlan.js";

// A row's spoken identity. The denomination is the name a collector uses, but
// a note scraped without one is still a note: the catalog number or the id
// keeps every control from reading "Select " or "Reorder " with nothing after
// it.
export function noteRowLabel(note) {
  return (
    String(note.denomination ?? "").trim() ||
    String(note.catalog_number ?? "").trim() ||
    `note ${note.id}`
  );
}

// Everything a row needs that is derived from its note and the current table
// configuration: the thumbnail, the filter marks, the tags chip plan, and the
// class/offset of every cell. The table builds one model per note per change;
// a row never recomputes these on an unrelated commit.
export function buildNoteRowModel({
  columnWidths,
  columns,
  lastStickyColumnKey,
  marks,
  note,
  stickyLeftByColumn,
}) {
  const cells = new Map();
  const tagsWidth = columnWidths[tagsColumnKey] ?? 0;
  // Body cells carry 12px of horizontal padding on each side; the tags plan
  // measures the content box those paddings leave.
  const tagsAvailableWidth = Math.max(0, tagsWidth - 24);
  // No observer of its own: the tags column width is part of the table's
  // geometry, and the table watches that with one ResizeObserver on the
  // scroller. A width change lands in `columnWidths`, which is why the model
  // is rebuilt at that width and never at any other.

  for (const column of columns) {
    const baseClassName = cellClass(column);
    cells.set(column.key, {
      className: stickyCellClass(column, baseClassName, lastStickyColumnKey),
      style: stickyCellStyle(column, stickyLeftByColumn),
    });
  }

  const tagsColumn = columns.find((column) => column.isTags);

  return {
    cells,
    frontThumb: noteThumbnailPath(note),
    marks: marks ?? {},
    tagPlan: tagsColumn
      ? computeVisibleTagPlan(note.tags, tagsAvailableWidth)
      : null,
  };
}
