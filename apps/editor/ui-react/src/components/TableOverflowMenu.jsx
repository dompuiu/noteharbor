import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { ColumnMenuBody } from "./ColumnPicker.jsx";

// The compact rail's one menu (container < 960px): Reset view and the column
// choices travel together once the trailing cluster is out of words. The two
// controls are the same components the wide rail shows, so nothing about
// resetting a view or toggling a column changes with the width.
export function TableOverflowMenu({
  canResetView,
  columns,
  disabledColumnKey,
  onResetView,
  onToggleColumn,
  resetTitle,
  visibleColumnKeys,
}) {
  return (
    <AnchoredPopover
      align="end"
      className="table-columns-menu table-overflow-menu"
      initialFocus={(panel) =>
        panel.querySelector("button, input:not(:disabled)")
      }
      panelLabel="View options"
      renderTrigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          aria-label="View options"
          className={`button table-overflow-toggle${open ? " table-columns-toggle--open" : ""}`}
          title="View options"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="15"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="15"
          >
            <circle cx="5" cy="12" r="1.4" />
            <circle cx="12" cy="12" r="1.4" />
            <circle cx="19" cy="12" r="1.4" />
          </svg>
        </button>
      )}
    >
      {({ close }) => (
        <>
          {canResetView ? (
            <button
              className="table-overflow-reset"
              onClick={() => {
                onResetView?.();
                close();
              }}
              title={resetTitle}
              type="button"
            >
              Reset view
            </button>
          ) : null}
          <ColumnMenuBody
            columns={columns}
            disabledColumnKey={disabledColumnKey}
            onToggle={onToggleColumn}
            visibleColumnKeys={visibleColumnKeys}
          />
        </>
      )}
    </AnchoredPopover>
  );
}
