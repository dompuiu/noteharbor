import { ColumnPicker } from "./ColumnPicker.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { TableFilterBar } from "./TableFilterBar.jsx";
import { TableFindBar } from "./TableFindBar.jsx";
import { TableSurface } from "./TableSurface.jsx";

const rowHeightEstimate = 45;
const tableGutterWidth = 14;

// The one notes table view: the card, its rail, the find bar, the virtualized
// surface and the footer. Both the Table screen and the All notes screen render
// this; they differ only in the controller data and the chrome slots they pass.
export function NotesTableView({
  ariaLabel,
  bulkBar = null,
  canResetView = false,
  columns,
  emptyContent,
  emptyView = false,
  filterBar,
  filterBarRef,
  focusAnchorRef,
  footerAnnouncer = null,
  footerHint = null,
  footerStatus = null,
  footerSummary,
  handlers,
  hideableColumns,
  lastVisibleDataColumnKey,
  onCloseShortcuts,
  onDragOver,
  onResetView,
  onToggleColumn,
  railStart = null,
  resetTitle = "Clears filters, sort and selection — keeps your columns",
  rows,
  shellRef,
  showBrowse = true,
  showPan = true,
  showShortcutsHelp = false,
  showToolbar = true,
  showToolbarShortcuts = true,
  surface,
  table,
  visibleColumnKeys,
}) {
  const { columnPan, cursor, find } = table;
  const emptyRow = emptyView ? (
    <tr className="table-empty-row">
      <td className="table-empty-cell" colSpan={table.totalColumnCount}>
        <div className="table-empty-frame">{emptyContent}</div>
      </td>
    </tr>
  ) : null;

  return (
    <>
      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={onCloseShortcuts} />
      ) : null}

      <div className="table-shell" onDragOver={onDragOver} ref={shellRef}>
        <span
          aria-hidden="true"
          className="table-focus-anchor"
          ref={focusAnchorRef}
          tabIndex={-1}
        />
        {showToolbar ? (
          <div className="table-rail">
            <TableFilterBar
              conditions={filterBar.conditions}
              defaultField={filterBar.defaultField}
              hasRows={filterBar.hasRows ?? rows.length > 0}
              onConditionsChange={filterBar.onConditionsChange}
              onFirstRow={filterBar.onFirstRow ?? cursor.focusFirstRow}
              ref={filterBarRef}
              searchColumns={filterBar.searchColumns}
              tagNames={filterBar.tagNames}
            />
            <div className="table-rail-actions">
              {railStart}
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
                  title={resetTitle}
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
          activeNoteId={cursor.activeNoteId}
          allVisibleSelected={surface.allVisibleSelected}
          ariaBusy={surface.ariaBusy}
          ariaLabel={ariaLabel}
          bottomSpacerHeight={cursor.bottomSpacerHeight}
          canMove={surface.canMove}
          canReorder={surface.canReorder}
          columnWidths={table.columnWidths}
          columns={columns}
          dragStateRef={surface.dragStateRef}
          emptyContent={emptyRow}
          emptyView={emptyView}
          findBar={find.isOpen ? <TableFindBar {...find.barProps} /> : null}
          findCurrentNoteId={find.currentMatchId}
          findMarksByNoteId={find.marksByNoteId}
          gutterWidth={tableGutterWidth}
          handlers={handlers}
          loading={surface.loading}
          notes={rows}
          onFirstRow={cursor.focusFirstRow}
          onLastRow={cursor.focusLastRow}
          onPage={cursor.pageRows}
          onReorder={surface.onReorder}
          onScroll={() => columnPan.syncColumnScroll()}
          onVisibleChange={table.setVScrollVisible}
          reorderRail={surface.reorderRail}
          rowCount={rows.length}
          rowElementFor={(noteId) => cursor.rowElementMapRef.current.get(noteId)}
          rowHeight={rowHeightEstimate}
          rowModelsByNoteId={table.rowModelsByNoteId}
          scrollHandlers={columnPan.scrollHandlers}
          scrollRef={cursor.scrollRef}
          selectAllRef={surface.selectAllRef}
          selectedIdSet={surface.selectedIdSet}
          showGutter={table.vScrollVisible}
          sortDirection={surface.sortDirection}
          sortKey={surface.sortKey}
          tableCellAttributes={table.tableCellAttributes}
          toggleAllVisible={surface.toggleAllVisible}
          toggleSort={surface.toggleSort}
          topSpacerHeight={cursor.topSpacerHeight}
          totalColumnCount={table.totalColumnCount}
          virtualRows={cursor.virtualRows}
        />
        {bulkBar}
      </div>
      <div className="table-footer-hint">
        {footerAnnouncer}
        <span
          aria-atomic="true"
          aria-live="polite"
          className="table-footer-summary"
        >
          {footerSummary}
        </span>
        <span className="table-footer-right">
          {footerStatus}
          <span className="table-footer-keys">
            {footerHint}
            {showBrowse && rows.length ? (
              <span className="table-footer-segment">
                <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to browse
              </span>
            ) : null}
            {showPan && columnPan.columnPanAvailable ? (
              <span className="table-footer-segment">
                <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to pan
              </span>
            ) : null}
            {showToolbarShortcuts ? (
              <span className="table-footer-segment">
                <kbd>?</kbd> shortcuts
              </span>
            ) : null}
          </span>
        </span>
      </div>
    </>
  );
}
