import { ColumnPicker } from "./ColumnPicker.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { TableCard } from "./TableCard.jsx";
import { TableFilterBar } from "./TableFilterBar.jsx";
import { TableFindBar } from "./TableFindBar.jsx";
import { TableOverflowMenu } from "./TableOverflowMenu.jsx";
import { TableSurface } from "./TableSurface.jsx";

const rowHeightEstimate = 45;
const tableGutterWidth = 14;
// The rail's controls stop trying to keep their words below this card width
// and slide into the one overflow menu. It sits a hair above the stylesheet's
// 960px query so the menu is already mounted when the words are hidden.
const compactRailWidth = 962;

// The one notes table view: the card, its rail, the virtualized surface and
// the footer. Both the Table screen and the All notes screen render this; they
// differ only in the controller data, the identity they put at the rail's
// leading edge, and the status they report.
export function NotesTableView({
  ariaLabel,
  body = null,
  bodyClassName = "",
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
  footerSummary = null,
  handlers,
  hideableColumns,
  lastVisibleDataColumnKey,
  onCloseShortcuts,
  onDragOver,
  onResetView,
  onToggleColumn,
  railIdentity = null,
  railNotice = null,
  railStatus = null,
  railStart = null,
  resetTitle = "Clears filters, sort and selection — keeps your columns",
  rows,
  shellRef,
  showShortcutsHelp = false,
  showToolbar = true,
  showToolbarShortcuts = true,
  statusSummary = null,
  surface,
  table,
  visibleColumnKeys,
}) {
  const { columnPan, cursor, find } = table;
  const railWidth = table.tableWidth ?? null;
  const compactRail = railWidth != null && railWidth < compactRailWidth;
  const emptyRow = emptyView ? (
    <tr className="table-empty-row">
      <td className="table-empty-cell" colSpan={table.totalColumnCount}>
        <div className="table-empty-frame">{emptyContent}</div>
      </td>
    </tr>
  ) : null;
  // The compact line the eye reads, with the full sentence kept as the live
  // region so assistive tech still hears the count, the sort and the selection
  // exactly as before.
  const status =
    statusSummary || footerSummary || railStatus ? (
      <>
        {statusSummary ? (
          <span aria-hidden="true" className="table-rail-status-visible">
            {statusSummary}
          </span>
        ) : null}
        {footerSummary ? (
          <span
            aria-atomic="true"
            aria-live="polite"
            className="table-footer-summary"
          >
            {footerSummary}
          </span>
        ) : null}
        {railStatus}
      </>
    ) : null;

  return (
    <>
      <TableCard
        bodyClassName={bodyClassName}
        focusAnchorRef={focusAnchorRef}
        onDragOver={onDragOver}
        railActions={
          showToolbar ? (
            <>
              {railStart}
              <button
                aria-label="Find in this view"
                className="button table-find-toggle"
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
                  aria-label="Reset view"
                  className="button table-reset-toggle"
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
                  <span className="table-rail-button-label">Reset view</span>
                </button>
              ) : null}
              <ColumnPicker
                columns={hideableColumns}
                disabledColumnKey={lastVisibleDataColumnKey}
                onToggle={onToggleColumn}
                visibleColumnKeys={visibleColumnKeys}
              />
              {compactRail ? (
                <TableOverflowMenu
                  canResetView={canResetView}
                  columns={hideableColumns}
                  disabledColumnKey={lastVisibleDataColumnKey}
                  onResetView={onResetView}
                  onToggleColumn={onToggleColumn}
                  resetTitle={resetTitle}
                  visibleColumnKeys={visibleColumnKeys}
                />
              ) : null}
            </>
          ) : null
        }
        railControls={
          showToolbar ? (
            <TableFilterBar
              availableWidth={railWidth == null ? null : railWidth - 20}
              conditions={filterBar.conditions}
              defaultField={filterBar.defaultField}
              entry={
                find.isOpen ? <TableFindBar {...find.barProps} /> : null
              }
              hasRows={filterBar.hasRows ?? rows.length > 0}
              onConditionsChange={filterBar.onConditionsChange}
              onFirstRow={filterBar.onFirstRow ?? cursor.focusFirstRow}
              ref={filterBarRef}
              searchColumns={filterBar.searchColumns}
              tagNames={filterBar.tagNames}
            />
          ) : null
        }
        railIdentity={railIdentity}
        railNotice={railNotice}
        railStatus={status}
        shellRef={shellRef}
        shortcuts={
          showShortcutsHelp ? (
            <KeyboardShortcutsHelp onClose={onCloseShortcuts} />
          ) : null
        }
      >
        {body ?? (
          <>
            <TableSurface
              activeNoteId={cursor.activeNoteId}
              allVisibleSelected={surface.allVisibleSelected}
              ariaBusy={surface.ariaBusy}
              ariaLabel={ariaLabel}
              bottomSpacerHeight={cursor.bottomSpacerHeight}
              bulkBarOpen={Boolean(bulkBar)}
              canMove={surface.canMove}
              canReorder={surface.canReorder}
              columnWidths={table.columnWidths}
              columns={columns}
              dragStateRef={surface.dragStateRef}
              emptyContent={emptyRow}
              emptyView={emptyView}
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
          </>
        )}
      </TableCard>
      {body ? null : (
        <div className="table-footer-hint">
          {footerAnnouncer}
          <span className="table-footer-keys">
            {footerHint}
            {columnPan.columnPanAvailable ? (
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
        </div>
      )}
    </>
  );
}
