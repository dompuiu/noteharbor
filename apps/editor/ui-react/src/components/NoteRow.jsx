import { Fragment, memo, useCallback } from "react";
import { TagsCell } from "./TagsCell.jsx";
import { RowActionsMenu } from "./RowActionsMenu.jsx";
import { highlightTerms } from "../lib/tableCells.jsx";
import { parseGradeValue } from "../lib/tableColumns.js";

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
        {canReorder ? (
          <button
            aria-label={`Move ${note.denomination}`}
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
          aria-label={`Select ${note.denomination}`}
          checked={isSelected}
          onChange={() => handlers.onToggleSelection(note.id)}
          type="checkbox"
        />
      </td>
    );
  }

  function renderOrderCell(column) {
    return (
      <td {...cellAttributes(column)}>
        {note.display_order ?? "-"}
      </td>
    );
  }

  function renderThumbnailCell(column) {
    return (
      <td {...cellAttributes(column)}>
        {model.frontThumb ? (
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
              alt={`${note.denomination} front`}
              className="table-thumb"
              decoding="async"
              loading="lazy"
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
        <td {...cellAttributes(column)}>
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
        <td {...cellAttributes(column)}>
          {note.url ? (
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
      <td {...cellAttributes(column)}>
        {highlightTerms(note[column.key], rowMarks[column.key])}
      </td>
    );
  }

  function renderActionsCell(column) {
    const noteLabel =
      note.denomination || note.catalog_number || `note ${note.id}`;
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
