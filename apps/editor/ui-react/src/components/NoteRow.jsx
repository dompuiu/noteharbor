import { Fragment, memo, useCallback, useState } from "react";
import { TagsCell } from "./TagsCell.jsx";
import { RowActionsMenu } from "./RowActionsMenu.jsx";
import { highlightTerms } from "../lib/tableCells.jsx";
import { parseGradeValue } from "../lib/tableColumns.js";

// A row's spoken identity. The denomination is the name a collector uses, but
// a note scraped without one is still a note: the catalog number or the id
// keeps every control from reading "Select " or "Reorder " with nothing after
// it.
function noteRowLabel(note) {
  return (
    String(note.denomination ?? "").trim() ||
    String(note.catalog_number ?? "").trim() ||
    `note ${note.id}`
  );
}

// One note row. The memo boundary lives here: props are plain values plus one
// stable `handlers` object, so moving the cursor, ticking a checkbox or
// hovering a thumbnail re-renders only the rows whose props changed.
//
// The contract, and what must stay true of it:
//
// - `note`: the server object itself. Its identity is stable until a refetch,
//   so a parent commit cannot make a row render by rebuilding a copy of it.
// - `index`: the note's position in the filtered list. Zebra parity reads it,
//   and it only changes when the list does.
// - `isSelected`, `isActive`, `isDragging`, `dropPlacement`: the four row-level
//   facts the table owns.
// - `model`: everything derived from the note and the table geometry — filter
//   marks, each cell's class and pinned offset, the thumbnail, the tags plan.
//   It is bundled because all of it is rebuilt together when the note, the
//   columns or the filter change, and a row must never recompute any of it.
// - `columns`, `showGutter`, `totalColumnCount`, `canReorder`: the table's
//   structure at this commit.
// - `reorderRail`: whether this view paints the reorder rail at all. It stays
//   true while an order save is in flight, so the rail never blanks mid-save;
//   `canReorder` is what gates the drop, not the paint.
// - `handlers`: one object with a stable identity; every member reads live
//   state through a ref instead of closing over it.
//
// Nothing here may become a fresh object, array or function per parent render:
// a new `columns` array or an inline handler re-renders every row, which is the
// cost this boundary exists to avoid.
export const NoteRow = memo(function NoteRow({
  canReorder,
  columns,
  dropPlacement,
  handlers,
  index,
  isActive,
  isDragging,
  isSelected,
  model,
  note,
  reorderRail,
  showGutter,
  totalColumnCount,
}) {
  // The dev readout counts the distinct rows that ran in the current commit.
  // Its set lives on a global that exists only while the readout is mounted,
  // so the optional call costs nothing when the readout is off and the whole
  // branch is dropped from production builds.
  if (import.meta.env.DEV) {
    globalThis.__noteHarborPerfRows?.add(note.id);
  }

  const zebra = index % 2 === 1;
  const noteLabel = noteRowLabel(note);

  // An image file can be missing — an archive moved between machines, a scrape
  // whose file never landed — and a broken-image glyph with alt text spilling
  // out of a 56px box is worse than the dash every other empty cell shows.
  // Remembering the failed source instead of a boolean lets a refetched note
  // (whose image path carries a new version) try again.
  const [failedThumbSrc, setFailedThumbSrc] = useState(null);
  const thumbFailed =
    failedThumbSrc != null && failedThumbSrc === model.frontThumb;

  const rowRef = useCallback(
    (element) => handlers.onRowElement(note.id, element),
    [handlers, note.id],
  );
  const thumbWrapRef = useCallback(
    (element) => handlers.onThumbElement(note.id, element),
    [handlers, note.id],
  );
  const actionsRef = useCallback(
    (instance) => handlers.onActionsRef(note.id, instance),
    [handlers, note.id],
  );

  // The row model already carries every cell's class, pinned offset and
  // derived content; the row only spreads it onto the <td>.
  function cellAttributes(column) {
    return model.cells.get(column.key) ?? {};
  }

  function renderReorderCell(column) {
    return (
      <td
        {...cellAttributes(column)}
        onClick={(event) => event.stopPropagation()}
      >
        {reorderRail ? (
          <button
            aria-label={`Reorder ${noteLabel}`}
            className="drag-handle"
            draggable={canReorder}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onDragEnd={() => handlers.onDragEnd()}
            onDragStart={(event) => handlers.onDragStart(note, event)}
            type="button"
          >
            <span className="drag-handle-dots" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          </button>
        ) : null}
      </td>
    );
  }

  function renderSelectionCell(column) {
    return (
      <td
        onClick={(event) => event.stopPropagation()}
        {...cellAttributes(column)}
      >
        <input
          aria-label={`Select ${noteLabel}`}
          checked={isSelected}
          onChange={() => handlers.onToggleSelection(note.id)}
          type="checkbox"
        />
      </td>
    );
  }

  function renderOrderCell(column) {
    const orderTitle =
      note.display_order == null ? undefined : String(note.display_order);

    return (
      <td {...cellAttributes(column)} title={orderTitle}>
        {note.display_order ?? <span className="muted">-</span>}
      </td>
    );
  }

  function renderThumbnailCell(column) {
    return (
      <td {...cellAttributes(column)}>
        {model.frontThumb && !thumbFailed ? (
          <span
            className="table-thumb-wrap"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                handlers.onThumbLeave(note.id);
              }
            }}
            onFocus={() => handlers.onThumbEnter(note.id)}
            onMouseEnter={() => handlers.onThumbEnter(note.id)}
            onMouseLeave={() => handlers.onThumbLeave(note.id)}
            ref={thumbWrapRef}
          >
            <img
              alt={`${noteLabel} front`}
              className="table-thumb"
              decoding="async"
              loading="lazy"
              onError={() => setFailedThumbSrc(model.frontThumb)}
              src={model.frontThumb}
            />
          </span>
        ) : (
          <span className="muted">-</span>
        )}
      </td>
    );
  }

  function renderDataCell(column) {
    const rowMarks = model.marks;
    // The cell clips to one line (see the stylesheet), so a long value cannot
    // grow the row past the virtualizer's fixed height. The title carries the
    // whole value to a pointer; an empty field gets no tooltip.
    const title = String(note[column.key] ?? "").trim() || undefined;
    // An empty field reads as the same muted dash the tags, grade and
    // thumbnail cells use, so one absence never looks like two different
    // things across a row.
    const empty = !String(note[column.key] ?? "").trim();

    if (column.isTags) {
      return (
        <td {...cellAttributes(column)}>
          <TagsCell
            onApplyFilter={handlers.onApplyTagFilter}
            tagPlan={model.tagPlan}
            tags={note.tags}
          />
        </td>
      );
    }

    if (column.key === "grade") {
      // Grade is the first attribute a collector compares across a row, and
      // the one the catalogue is bought and sold on. It reads as a value, not
      // as more body text: tabular figures so columns of grades line up, and
      // a tint that separates the uncirculated band from the rest.
      const gradeValue = String(note.grade ?? "").trim();

      if (!gradeValue) {
        return (
          <td {...cellAttributes(column)}>
            <span className="muted">-</span>
          </td>
        );
      }

      const numericGrade = parseGradeValue(gradeValue);
      const tier =
        numericGrade == null
          ? "none"
          : numericGrade >= 65
            ? "unc"
            : numericGrade >= 50
              ? "choice"
              : "circulated";

      return (
        <td {...cellAttributes(column)} title={gradeValue}>
          <span className={`table-grade table-grade--${tier}`}>
            {highlightTerms(gradeValue, rowMarks.grade)}
          </span>
        </td>
      );
    }

    if (column.key === "denomination") {
      // The denomination is the note's source link: collectors expect it to
      // open the page the note came from, not the slideshow. The row itself
      // and the row menu's Open item still reach the Note slideshow. A note
      // without a source URL renders as plain text.
      return (
        <td {...cellAttributes(column)} title={title}>
          {empty ? (
            <span className="muted">-</span>
          ) : note.url ? (
            <a
              draggable={false}
              href={note.url}
              onClick={(event) => event.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              {highlightTerms(note.denomination, rowMarks.denomination)}
            </a>
          ) : (
            highlightTerms(note.denomination, rowMarks.denomination)
          )}
        </td>
      );
    }

    return (
      <td {...cellAttributes(column)} title={title}>
        {empty ? (
          <span className="muted">-</span>
        ) : (
          highlightTerms(note[column.key], rowMarks[column.key])
        )}
      </td>
    );
  }

  function renderActionsCell(column) {
    const items = [
      {
        key: "open",
        icon: "open",
        label: "Open",
        onSelect: () => handlers.onOpenNote(note.id),
      },
      {
        key: "edit",
        icon: "edit",
        label: "Edit",
        onSelect: () => handlers.onEditNote(note.id),
        shortcut: "e",
      },
      {
        key: "copy",
        icon: "copy",
        label: "Copy details",
        onSelect: () => handlers.onCopyNote(note),
        shortcut: "c",
      },
      {
        key: "insert",
        icon: "insert",
        label: "Insert note below",
        onSelect: () => handlers.onInsertNoteAfter(note.id),
        shortcut: "a",
      },
    ];

    if (note.url) {
      items.push({
        key: "source",
        icon: "source",
        label: "Open source",
        href: note.url,
      });
    }

    items.push({
      key: "delete",
      icon: "delete",
      label: "Delete",
      onSelect: () => handlers.onDeleteNote(note.id),
      danger: true,
      separated: true,
      shortcut: "d",
    });

    return (
      <td {...cellAttributes(column)}>
        <RowActionsMenu
          items={items}
          label={`Actions for ${noteLabel}`}
          ref={actionsRef}
          shortcut="o"
        />
      </td>
    );
  }

  function renderCell(column) {
    switch (column.kind) {
      case "reorder":
        return renderReorderCell(column);
      case "selection":
        return renderSelectionCell(column);
      case "order":
        return renderOrderCell(column);
      case "thumbnail":
        return renderThumbnailCell(column);
      case "data":
        return renderDataCell(column);
      case "actions":
        return renderActionsCell(column);
      default:
        return null;
    }
  }

  function rowClassName() {
    return [
      "table-row-link",
      zebra ? "table-row-link--zebra" : null,
      isDragging ? "table-row-link--dragging" : null,
      isSelected ? "table-row-link--selected" : null,
      isActive ? "table-row-link--active" : null,
    ]
      .filter(Boolean)
      .join(" ");
  }

  return (
    <Fragment>
      {dropPlacement === "before" ? (
        <tr className="table-drop-placeholder-row" aria-hidden="true">
          <td
            className="table-drop-placeholder-cell"
            colSpan={totalColumnCount}
          >
            <span className="table-drop-placeholder-line" />
          </td>
        </tr>
      ) : null}
      <tr
        className={rowClassName()}
        data-index={index}
        onBlur={(event) => handlers.onRowBlur(note, event)}
        onClick={(event) => handlers.onRowClick(note, event)}
        onDragLeave={(event) => handlers.onRowDragLeave(note, event)}
        onDragOver={(event) => handlers.onRowDragOver(note, event)}
        onDrop={(event) => handlers.onRowDrop(note, event)}
        onFocus={() => handlers.onRowFocus(note)}
        onKeyDown={(event) => handlers.onRowKeyDown(note, event)}
        onMouseDown={() => handlers.onRowMouseDown()}
        onMouseUp={() => handlers.onRowMouseUp()}
        ref={rowRef}
        tabIndex={0}
      >
        {columns.map((column) => (
          <Fragment key={column.key}>{renderCell(column)}</Fragment>
        ))}
        {showGutter ? (
          <td aria-hidden="true" className="table-gutter-cell" />
        ) : null}
      </tr>
      {dropPlacement === "after" ? (
        <tr className="table-drop-placeholder-row" aria-hidden="true">
          <td
            className="table-drop-placeholder-cell"
            colSpan={totalColumnCount}
          >
            <span className="table-drop-placeholder-line" />
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
});
