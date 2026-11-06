import { TableRows } from "./TableRows.jsx";
import { TableScrollbar } from "./TableScrollbar.jsx";

// The table card's viewport: the optional find bar floating over the rows,
// the single scroller that owns both axes, the sticky header, the virtualized
// body, and the custom vertical scrollbar. Every screen that paints the notes
// table uses this one composition, so a column, a header cell or a scroll
// affordance can never drift between screens.
export function TableSurface({
  activeNoteId,
  allVisibleSelected,
  ariaBusy,
  ariaLabel,
  bottomSpacerHeight,
  canMove,
  canReorder,
  columnWidths,
  columns,
  dragStateRef,
  emptyContent,
  emptyView,
  findBar,
  findCurrentNoteId,
  findMarksByNoteId,
  gutterWidth,
  handlers,
  loading,
  notes,
  onFirstRow,
  onLastRow,
  onPage,
  onReorder,
  onScroll,
  onVisibleChange,
  reorderRail,
  rowCount,
  rowElementFor,
  rowHeight,
  rowModelsByNoteId,
  scrollHandlers,
  scrollRef,
  selectAllRef,
  selectedIdSet,
  showGutter,
  sortDirection,
  sortKey,
  tableCellAttributes,
  toggleAllVisible,
  toggleSort,
  topSpacerHeight,
  totalColumnCount,
  virtualRows,
}) {
  return (
    <div className="table-viewport">
      {findBar}
      <div
        aria-label={ariaLabel}
        className="table-scroll-x"
        role={ariaLabel ? "region" : undefined}
        {...scrollHandlers}
        onScroll={onScroll}
        ref={scrollRef}
      >
        <div
          className={`table-scroll-content${emptyView ? " is-empty-view" : ""}`}
        >
          <table aria-busy={ariaBusy || undefined}>
            <colgroup>
              {columns.map((column) => (
                <col
                  key={column.key}
                  style={{
                    width: `${columnWidths[column.key] ?? column.width ?? 0}px`,
                  }}
                />
              ))}
              {showGutter ? <col style={{ width: `${gutterWidth}px` }} /> : null}
            </colgroup>
            <thead>
              <tr>
                {columns.map((column) => {
                  if (column.kind === "reorder") {
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        {...tableCellAttributes(column)}
                      />
                    );
                  }

                  if (column.kind === "selection") {
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        {...tableCellAttributes(column)}
                      >
                        <input
                          aria-label="Select all visible rows"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                          ref={selectAllRef}
                          type="checkbox"
                        />
                      </th>
                    );
                  }

                  if (!column.sortable) {
                    // The actions column carries no visible label: the
                    // three-dot button explains itself. Keep the name for
                    // assistive tech so the column is not anonymous.
                    const isActions = column.kind === "actions";

                    return (
                      <th
                        aria-label={isActions ? column.label : undefined}
                        key={column.key}
                        scope="col"
                        {...tableCellAttributes(column)}
                      >
                        {isActions ? null : column.label}
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
                      {...tableCellAttributes(column)}
                    >
                      <button
                        className={`sort-button${isSorted ? " sort-button--active" : ""}`}
                        onClick={() => toggleSort(column.key)}
                        type="button"
                      >
                        {column.label}
                        {/* Drawn on every sortable header: the stylesheet keeps
                            it hidden until hover and lets the sorted column
                            keep it visible. */}
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
                {showGutter ? (
                  <th
                    aria-hidden="true"
                    className="table-gutter-cell"
                    scope="col"
                  />
                ) : null}
              </tr>
            </thead>
            <TableRows
              activeNoteId={activeNoteId}
              canMove={canMove}
              canReorder={canReorder}
              columns={columns}
              dragStateRef={dragStateRef}
              emptyContent={emptyContent}
              findCurrentNoteId={findCurrentNoteId}
              findMarksByNoteId={findMarksByNoteId}
              handlers={handlers}
              notes={notes}
              onReorder={onReorder}
              reorderRail={reorderRail}
              rowElementFor={rowElementFor}
              rowModelsByNoteId={rowModelsByNoteId}
              selectedIdSet={selectedIdSet}
              showGutter={showGutter}
              topSpacerHeight={topSpacerHeight}
              bottomSpacerHeight={bottomSpacerHeight}
              totalColumnCount={totalColumnCount}
              virtualRows={virtualRows}
            />
          </table>
        </div>
      </div>
      <TableScrollbar
        loading={loading}
        onFirstRow={onFirstRow}
        onLastRow={onLastRow}
        onPage={onPage}
        onVisibleChange={onVisibleChange}
        rowCount={rowCount}
        rowHeight={rowHeight}
        scrollRef={scrollRef}
      />
    </div>
  );
}
