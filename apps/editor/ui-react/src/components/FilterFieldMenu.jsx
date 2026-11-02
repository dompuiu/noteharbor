import { AnchoredPopover } from "./AnchoredPopover.jsx";

// The field picker inside the table's filter bar. It reads as a small pill in
// the field, but opens a menu instead of the native <select> so the arrow,
// type scale and selected state match the rest of the toolbar. The shared
// popover shell owns Escape, dismissal and positioning; this file owns the
// menu's roving focus.
export function FilterFieldMenu({ onChange, options, value }) {
  const current = options.find((option) => option.key === value);

  function choices(panel) {
    return Array.from(
      panel?.querySelectorAll('[role="menuitemradio"]') ?? [],
    );
  }

  function moveFocus(event, panel, offset) {
    const items = choices(panel);

    if (!items.length) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = (currentIndex + offset + items.length) % items.length;
    items[nextIndex].focus();
  }

  function handleMenuKeyDown(event, panel) {
    switch (event.key) {
      case "ArrowDown":
        moveFocus(event, panel, 1);
        break;
      case "ArrowUp":
        moveFocus(event, panel, -1);
        break;
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        choices(panel)[0]?.focus();
        break;
      case "End": {
        event.preventDefault();
        event.stopPropagation();
        const items = choices(panel);
        items[items.length - 1]?.focus();
        break;
      }
      default:
        break;
    }
  }

  return (
    <AnchoredPopover
      className="table-filter-menu"
      // Land keyboard focus on the checked field, so arrows move from the
      // current choice rather than the top of the list.
      initialFocus={(panel) =>
        panel.querySelector('[role="menuitemradio"][aria-checked="true"]')
      }
      panelLabel="Filter field"
      onKeyDown={handleMenuKeyDown}
      renderTrigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          aria-label={`Filter field: ${current?.label ?? "All fields"}`}
          className={`table-filter-field${open ? " table-filter-field--open" : ""}`}
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
      )}
      role="menu"
    >
      {({ close }) => (
        <>
          <p className="table-filter-menu-heading">Filter field</p>
          {options.map((option) => (
            <button
              aria-checked={option.key === value}
              className="table-filter-menu-item"
              key={option.key}
              onClick={() => {
                close();
                onChange(option.key);
              }}
              role="menuitemradio"
              type="button"
            >
              {option.label}
            </button>
          ))}
        </>
      )}
    </AnchoredPopover>
  );
}
