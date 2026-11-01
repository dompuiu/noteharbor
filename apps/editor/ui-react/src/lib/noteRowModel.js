import {
  cellClass,
  pickFirstAvailableImage,
  tableThumbnailSlots,
} from "./tableCells.jsx";
import { tagsColumnKey } from "./tableColumns.js";
import { computeVisibleTagPlan } from "./tagChipPlan.js";

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

  for (const column of columns) {
    const baseClassName = cellClass(column);
    cells.set(column.key, {
      className: column.sticky
        ? [
            baseClassName,
            "table-sticky-cell",
            column.key === lastStickyColumnKey ? "table-sticky-end" : null,
          ]
            .filter(Boolean)
            .join(" ")
        : baseClassName,
      style: column.sticky
        ? {
            "--table-sticky-left": `${stickyLeftByColumn[column.key] ?? 0}px`,
          }
        : undefined,
    });
  }

  const tagsColumn = columns.find((column) => column.isTags);

  return {
    cells,
    frontThumb: pickFirstAvailableImage(note, tableThumbnailSlots)?.path ?? null,
    marks: marks ?? {},
    tagPlan: tagsColumn
      ? computeVisibleTagPlan(note.tags, tagsAvailableWidth)
      : null,
  };
}
