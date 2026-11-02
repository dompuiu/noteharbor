import { AnchoredPopover } from "./AnchoredPopover.jsx";

// The Columns toolbar control and its checkbox menu. The shared popover shell
// portals the menu into <body> so the table's scroll containers cannot clip
// it; the caller owns which columns are visible and what toggling one means.
export function ColumnPicker({
  columns,
  disabledColumnKey,
  onToggle,
  visibleColumnKeys,
}) {
  return (
    <AnchoredPopover
      className="table-columns-menu"
      // Land keyboard focus on the first choice, so Escape and Space work
      // without a Tab. The shell falls back to the panel itself when every
      // column is somehow disabled.
      initialFocus={(panel) =>
        panel.querySelector('input[type="checkbox"]:not(:disabled)')
      }
      panelLabel="Visible columns"
      renderTrigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          className={`button table-columns-toggle${open ? " table-columns-toggle--open" : ""}`}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="15"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            width="15"
          >
            <rect height="16" rx="2" width="18" x="3" y="4" />
            <path d="M9 4v16M15 4v16" />
          </svg>
          Columns
        </button>
      )}
    >
      <p className="table-columns-menu-heading">Visible columns</p>
      {columns.map((column) => (
        <label className="table-columns-option" key={column.key}>
          <input
            checked={visibleColumnKeys.includes(column.key)}
            disabled={column.key === disabledColumnKey}
            onChange={() => onToggle(column.key)}
            type="checkbox"
          />
          <span>{column.label}</span>
        </label>
      ))}
    </AnchoredPopover>
  );
}
