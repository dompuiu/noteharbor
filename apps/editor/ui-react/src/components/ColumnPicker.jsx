import { Fragment, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The Columns toolbar control and its checkbox menu. The menu is portalled
// into <body> so the table's scroll containers cannot clip it; the caller owns
// which columns are visible and what toggling one means.
export function ColumnPicker({ columns, visibleColumnKeys }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const menuId = useId();

  return (
    <Fragment>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`button table-columns-toggle${open ? " table-columns-toggle--open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        ref={buttonRef}
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
      {open
        ? createPortal(
            <div
              aria-label="Visible columns"
              className="table-columns-menu"
              id={menuId}
              role="dialog"
            >
              <p className="table-columns-menu-heading">Visible columns</p>
              {columns.map((column) => (
                <label className="table-columns-option" key={column.key}>
                  <input
                    checked={visibleColumnKeys.includes(column.key)}
                    readOnly
                    type="checkbox"
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
}
