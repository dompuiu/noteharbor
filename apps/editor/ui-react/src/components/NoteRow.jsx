import { Fragment, memo, useCallback } from "react";
import { TagsCell } from "./TagsCell.jsx";
import { RowActionsMenu } from "./RowActionsMenu.jsx";
import { cellClass, highlightTerms } from "../lib/tableCells.jsx";
import { parseGradeValue } from "../lib/tableColumns.js";

// One note row. The memo boundary lives here: props are plain values plus one
// stable `handlers` object, so moving the cursor, ticking a checkbox or
// hovering a thumbnail re-renders only the rows whose props changed.
export const NoteRow = memo(function NoteRow({
  canReorder,
  columns,
  dropPlacement,
  frontThumb,
  handlers,
  index,
  isActive,
  isDragging,
  isSelected,
  lastStickyColumnKey,
  marks,
  note,
  previewOffsetY,
  previewVisible,
  showGutter,
  stickyLeftByColumn,
  totalColumnCount,
}) {
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

  // Props shared by every pinned cell: the left offset accumulated from the
  // visible sticky columns, the end marker on the right-most one, and any
  // class the cell already needed.
  function stickyCellAttributes(column, baseClassName) {
    if (!column.sticky) {
      return baseClassName ? { className: baseClassName } : {};
    }

    return {
      className: [
        baseClassName,
        "table-sticky-cell",
        column.key === lastStickyColumnKey ? "table-sticky-end" : null,
      ]
        .filter(Boolean)
        .join(" "),
      // Native sticky positions the cell at this offset in the shared
      // horizontal scrollport.
      style: {
        "--table-sticky-left": `${stickyLeftByColumn[column.key] ?? 0}px`,
      },
    };
  }

  function renderReorderCell(column) {
    return (
      <td
        {...stickyCellAttributes(column, cellClass(column))}
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
        {...stickyCellAttributes(column, cellClass(column))}
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
      <td {...stickyCellAttributes(column, cellClass(column))}>
        {note.display_order ?? "-"}
      </td>
    );
  }

  function renderThumbnailCell(column) {
    return (
      <td {...stickyCellAttributes(column, cellClass(column))}>
        {frontThumb ? (
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
              src={frontThumb}
            />
            <span
              className={`table-thumb-preview${previewVisible ? " is-visible" : ""}`}
              style={{
                "--table-thumb-preview-offset": `${
                  previewVisible ? previewOffsetY : 0
                }px`,
              }}
            >
              {previewVisible ? <img alt="" src={frontThumb} /> : null}
            </span>
          </span>
        ) : (
          <span className="muted">-</span>
        )}
      </td>
    );
  }

  function renderDataCell(column) {
    const rowMarks = marks ?? {};

    if (column.isTags) {
      return (
        <td className={cellClass(column)}>
          <TagsCell
            onApplyFilter={handlers.onApplyTagFilter}
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
          <td {...stickyCellAttributes(column, cellClass(column))}>
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
        <td {...stickyCellAttributes(column, cellClass(column))}>
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
        <td className={cellClass(column)}>
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
      <td {...stickyCellAttributes(column, cellClass(column))}>
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
      <td className={cellClass(column)}>
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
