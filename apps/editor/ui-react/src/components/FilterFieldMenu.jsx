import { Fragment, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../lib/useAnchoredPopover.js";

// The field picker inside the table's filter bar. It reads as a small pill in
// the field, but opens a menu instead of the native <select> so the arrow,
// type scale and selected state match the rest of the toolbar.
export function FilterFieldMenu({ onChange, options, value }) {
  const { buttonRef, menuRef, open, position, setOpen } = useAnchoredPopover();
  const menuId = useId();
  const current = options.find((option) => option.key === value);

  useEffect(() => {
    if (!open) {
      return;
    }

    // Land keyboard focus on the checked field, so arrows move from the
    // current choice rather than the top of the list.
    const checked = menuRef.current?.querySelector(
      '[role="menuitemradio"][aria-checked="true"]',
    );
    (checked ?? menuRef.current)?.focus();
  }, [menuRef, open]);

  function closeMenu({ returnFocus = false } = {}) {
    setOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function fields() {
    return Array.from(
      menuRef.current?.querySelectorAll('[role="menuitemradio"]') ?? [],
    );
  }

  function moveFocus(event, offset) {
    const items = fields();

    if (!items.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    items[nextIndex].focus();
  }

  function handleMenuKeyDown(event) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ returnFocus: true });
        break;
      case "ArrowDown":
        moveFocus(event, 1);
        break;
      case "ArrowUp":
        moveFocus(event, -1);
        break;
      case "Home": {
        event.preventDefault();
        event.stopPropagation();
        fields()[0]?.focus();
        break;
      }
      case "End": {
        event.preventDefault();
        event.stopPropagation();
        const items = fields();
        items[items.length - 1]?.focus();
        break;
      }
      default:
        break;
    }
  }

  function handleMenuBlur(event) {
    // Tabbing out of the menu closes it; focus moving between its options
    // stays inside.
    if (menuRef.current?.contains(event.relatedTarget)) {
      return;
    }

    setOpen(false);
  }

  function choose(key) {
    setOpen(false);
    onChange(key);
  }

  return (
    <Fragment>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Filter field: ${current?.label ?? "All fields"}`}
        className={`table-filter-field${open ? " table-filter-field--open" : ""}`}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        ref={buttonRef}
        type="button"
      >
        <span className="table-filter-field-label">
          {current?.label ?? "All fields"}
        </span>
        <svg
          aria-hidden="true"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.4"
          viewBox="0 0 24 24"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              aria-label="Filter field"
              className="table-filter-menu"
              id={menuId}
              onBlur={handleMenuBlur}
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
              }}
            >
              <p className="table-filter-menu-heading">Filter field</p>
              {options.map((option) => (
                <button
                  aria-checked={option.key === value}
                  className="table-filter-menu-item"
                  key={option.key}
                  onClick={() => choose(option.key)}
                  role="menuitemradio"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
}
