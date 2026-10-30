import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// Gap between the button and the floating menu, and the margin the menu keeps
// from the viewport edges when it slides into view.
const menuOffset = 6;
const viewportMargin = 12;

// The Columns toolbar control and its checkbox menu. The menu is portalled
// into <body> so the table's scroll containers cannot clip it; the caller owns
// which columns are visible and what toggling one means.
export function ColumnPicker({
  columns,
  disabledColumnKey,
  onToggle,
  visibleColumnKeys,
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    function closeOnOutsidePress(event) {
      if (
        menuRef.current?.contains(event.target) ||
        buttonRef.current?.contains(event.target)
      ) {
        return;
      }

      setOpen(false);
    }

    function closeOnMove() {
      setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsidePress);
    document.addEventListener("touchstart", closeOnOutsidePress);
    window.addEventListener("scroll", closeOnMove, true);
    window.addEventListener("resize", closeOnMove);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsidePress);
      document.removeEventListener("touchstart", closeOnOutsidePress);
      window.removeEventListener("scroll", closeOnMove, true);
      window.removeEventListener("resize", closeOnMove);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const button = buttonRef.current;
    const menu = menuRef.current;

    if (!button || !menu) {
      return;
    }

    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let top = buttonRect.bottom + menuOffset;

    if (top + menuRect.height > window.innerHeight - viewportMargin) {
      top = Math.max(
        viewportMargin,
        buttonRect.top - menuRect.height - menuOffset,
      );
    }

    const left = Math.min(
      Math.max(viewportMargin, buttonRect.left),
      Math.max(
        viewportMargin,
        window.innerWidth - menuRect.width - viewportMargin,
      ),
    );

    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Land keyboard focus on the first choice, so Escape and Space work
    // without a Tab. The dialog itself is the fallback when every column is
    // somehow disabled.
    const firstCheckbox = menuRef.current?.querySelector(
      'input[type="checkbox"]:not(:disabled)',
    );
    (firstCheckbox ?? menuRef.current)?.focus();
  }, [open]);

  function closePicker({ returnFocus = false } = {}) {
    setOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function handleMenuKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closePicker({ returnFocus: true });
  }

  function handleMenuBlur(event) {
    // Tabbing out of the picker closes it; focus moving between its
    // checkboxes stays inside.
    if (
      menuRef.current?.contains(event.relatedTarget) ||
      buttonRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }

    setOpen(false);
  }

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
              onBlur={handleMenuBlur}
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="dialog"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
              }}
              tabIndex={-1}
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
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
}
