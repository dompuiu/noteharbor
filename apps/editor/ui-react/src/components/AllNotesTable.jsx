import { Fragment, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { buildNoteRowModel, noteRowLabel } from "../lib/noteRowModel.js";
import { marksForNote } from "../lib/noteView.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import {
  cellClass,
  highlightTerms,
  stickyCellAttributes,
} from "../lib/tableCells.jsx";
import {
  getTableColumn,
  gradeTier,
  lastStickyKey,
  stickyOffsets,
} from "../lib/tableColumns.js";
import { TagsCell } from "./TagsCell.jsx";
import { TableFilterBar } from "./TableFilterBar.jsx";

// The All notes screen's read-only column model. It borrows every note column's
// label, kind, alignment and sort metadata from the shared Table model, then
// overrides only this screen's geometry: a sticky Collection column, no pinned
// identity block, and the widths from the spec. Editing columns simply do not
// exist here.
const noteColumn = (key, overrides) => ({
  ...getTableColumn(key),
  sticky: false,
  ...overrides,
});

const columns = [
  {
    key: "collection",
    label: "Collection",
    kind: "data",
    width: 200,
    align: "left",
    sortable: true,
    sticky: true,
  },
  noteColumn("thumbnail", { width: 64, align: "center" }),
  noteColumn("catalog_number", { width: 130 }),
  noteColumn("denomination", { width: 130, align: "right" }),
  noteColumn("issue_date", { width: 120 }),
  noteColumn("grading_company", { width: 120 }),
  noteColumn("grade", { width: 100, align: "center" }),
  noteColumn("serial", { width: 160 }),
  noteColumn("tags", { width: 220 }),
];

const columnWidths = Object.fromEntries(
  columns.map((column) => [column.key, column.width]),
);
const lastStickyColumnKey = lastStickyKey(columns);
const stickyLeftByColumn = stickyOffsets(columns, columnWidths);

function collectionNameFor(note) {
  return String(note.collection_name ?? "").trim() || "Collection";
}

function isInteractiveTarget(target) {
  return Boolean(
    target instanceof Element &&
      target.closest("a, button, select, input, label, textarea"),
  );
}

function GradeCell({ marks, note }) {
  const grade = String(note.grade ?? "").trim();

  if (!grade) {
    return <span className="muted">-</span>;
  }

  const tier = gradeTier(grade);

  return (
    <span className={`table-grade table-grade--${tier}`}>
      {highlightTerms(grade, marks.grade)}
    </span>
  );
}

function AllNotesRow({ index, model, note, onApplyTagFilter, onOpenNote }) {
  const [failedThumbSrc, setFailedThumbSrc] = useState(null);
  const thumbFailed =
    failedThumbSrc != null && failedThumbSrc === model.frontThumb;
  const collectionName = collectionNameFor(note);
  const catalog = String(note.catalog_number ?? "").trim();
  const zebra = index % 2 === 1;

  function cellAttributes(column) {
    return model.cells.get(column.key) ?? {};
  }

  function openNote(event) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    onOpenNote(note);
  }

  function renderCell(column) {
    const attributes = cellAttributes(column);
    const value = String(note[column.key] ?? "").trim();

    switch (column.key) {
      case "collection":
        return (
          <td {...attributes} title={collectionName}>
            <span className="all-notes-collection">{collectionName}</span>
          </td>
        );
      case "thumbnail":
        return (
          <td {...attributes}>
            {model.frontThumb && !thumbFailed ? (
              <img
                alt={`Front of ${noteRowLabel(note)}`}
                className="table-thumb all-notes-thumb"
                decoding="async"
                loading="lazy"
                onError={() => setFailedThumbSrc(model.frontThumb)}
                src={model.frontThumb}
              />
            ) : (
              <span className="muted">-</span>
            )}
          </td>
        );
      case "catalog_number":
        return (
          <td {...attributes} title={catalog || undefined}>
            {catalog ? (
              <Link
                aria-label={`Open ${catalog} in ${collectionName}`}
                className="all-notes-note-link"
                to={CATALOG_ROUTES.noteSlideshow(
                  note.collection_id,
                  note.id,
                )}
              >
                {highlightTerms(catalog, model.marks.catalog_number)}
              </Link>
            ) : (
              <span className="muted">-</span>
            )}
          </td>
        );
      case "denomination":
        // The denomination is the note's source link on the Table screen, and
        // that meaning carries over here. The row itself still opens the
        // Note slideshow; the link stops row navigation.
        return (
          <td {...attributes} title={value || undefined}>
            {!value ? (
              <span className="muted">-</span>
            ) : note.url ? (
              <a
                href={note.url}
                onClick={(event) => event.stopPropagation()}
                rel="noreferrer"
                target="_blank"
              >
                {highlightTerms(note.denomination, model.marks.denomination)}
              </a>
            ) : (
              highlightTerms(note.denomination, model.marks.denomination)
            )}
          </td>
        );
      case "grade":
        return (
          <td {...attributes} title={value || undefined}>
            <GradeCell marks={model.marks} note={note} />
          </td>
        );
      case "tags":
        return (
          <td {...attributes}>
            <TagsCell
              onApplyFilter={onApplyTagFilter}
              tagPlan={model.tagPlan}
              tags={note.tags}
            />
          </td>
        );
      default:
        return (
          <td {...attributes} title={value || undefined}>
            {value ? (
              highlightTerms(note[column.key], model.marks[column.key])
            ) : (
              <span className="muted">-</span>
            )}
          </td>
        );
    }
  }

  return (
    <tr
      className={`table-row-link${zebra ? " table-row-link--zebra" : ""}`}
      onClick={openNote}
    >
      {columns.map((column) => (
        <Fragment key={column.key}>{renderCell(column)}</Fragment>
      ))}
    </tr>
  );
}

export function AllNotesTable({
  collectionOptions,
  conditions,
  emptyContent,
  hasActiveFilters,
  notes,
  onApplyTagFilter,
  onClearFilters,
  onCollectionChange,
  onConditionsChange,
  onOpenNote,
  onSort,
  searchColumns,
  selectedCollectionId,
  showToolbar = true,
  sortDirection,
  sortKey,
  summary,
  tagNames,
}) {
  const scrollRef = useRef(null);
  const [scrolledX, setScrolledX] = useState(false);
  const rowModelsByNoteId = useMemo(
    () =>
      new Map(
        notes.map((note) => [
          note.id,
          buildNoteRowModel({
            columnWidths,
            columns,
            lastStickyColumnKey,
            marks: conditions?.length
              ? marksForNote(note, conditions, searchColumns)
              : null,
            note,
            stickyLeftByColumn,
          }),
        ]),
      ),
    [conditions, notes, searchColumns],
  );

  function focusFirstNote() {
    scrollRef.current
      ?.querySelector(".all-notes-note-link")
      ?.focus({ preventScroll: false });
  }

  function headerCellAttributes(column) {
    return stickyCellAttributes(column, cellClass(column), {
      lastStickyColumnKey,
      stickyLeftByColumn,
    });
  }

  return (
    <>
      <div className="table-shell">
        {showToolbar ? (
          <div className="table-rail">
            <TableFilterBar
              conditions={conditions}
              defaultField="all"
              hasRows={notes.length > 0}
              onConditionsChange={onConditionsChange}
              onFirstRow={focusFirstNote}
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
              {hasActiveFilters ? (
                <button
                  className="button"
                  onClick={onClearFilters}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="table-viewport">
          <div
            aria-label="All notes table"
            className={`table-scroll-x all-notes-scroll${scrolledX ? " is-scrolled-x" : ""}`}
            onScroll={(event) => {
              const next = event.currentTarget.scrollLeft > 0;
              setScrolledX((current) => (current === next ? current : next));
            }}
            ref={scrollRef}
            tabIndex={0}
          >
            <div
              className={`table-scroll-content${notes.length ? "" : " is-empty-view"}`}
            >
              <table className="all-notes-table">
                <caption className="all-notes-caption">
                  All notes across collections
                </caption>
                <colgroup>
                  {columns.map((column) => (
                    <col
                      key={column.key}
                      style={{ width: `${column.width}px` }}
                    />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {columns.map((column) => {
                      if (!column.sortable) {
                        return (
                          <th
                            key={column.key}
                            scope="col"
                            {...headerCellAttributes(column)}
                          >
                            {column.label}
                          </th>
                        );
                      }

                      const isSorted = sortKey === column.key;

                      return (
                        <th
                          aria-sort={
                            isSorted
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          key={column.key}
                          scope="col"
                          {...headerCellAttributes(column)}
                        >
                          <button
                            className={`sort-button${isSorted ? " sort-button--active" : ""}`}
                            onClick={() => onSort(column.key)}
                            type="button"
                          >
                            {column.label}
                            <svg
                              aria-hidden="true"
                              className="sort-chevron"
                              focusable="false"
                              viewBox="0 0 24 24"
                            >
                              <path
                                d="m6 15 6-6 6 6"
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth="2.4"
                              />
                            </svg>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {notes.length ? (
                    notes.map((note, index) => (
                      <AllNotesRow
                        index={index}
                        key={note.id}
                        model={rowModelsByNoteId.get(note.id)}
                        note={note}
                        onApplyTagFilter={onApplyTagFilter}
                        onOpenNote={onOpenNote}
                      />
                    ))
                  ) : (
                    <tr className="table-empty-row">
                      <td
                        className="table-empty-cell"
                        colSpan={columns.length}
                      >
                        <div className="table-empty-frame">
                          {emptyContent}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
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
          Open a note to see it in its collection.
        </span>
      </div>
    </>
  );
}
