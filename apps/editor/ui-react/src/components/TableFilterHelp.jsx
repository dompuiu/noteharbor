import { Fragment, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../lib/useAnchoredPopover.js";

// The rail's `?` trigger. The empty table no longer spends a row on the
// field/Enter model, so this note carries the sentence (and the OR/AND rule)
// without reserving space. Portalled into <body> like the field and column
// menus, so the table's scroll containers cannot clip it.
export function TableFilterHelp() {
  const { buttonRef, menuRef, open, position, setOpen } = useAnchoredPopover();
  const noteId = useId();

  useEffect(() => {
    // The note is text, not a list: focus it so Escape works without a Tab.
    if (open) {
      menuRef.current?.focus();
    }
  }, [menuRef, open]);

  function closeNote({ returnFocus = false } = {}) {
    setOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    // The trigger only owns Escape while the note is open. With it closed,
    // leaving the event alone lets the table's chrome rule clear a
    // selection or filter, as it does for the other rail controls.
    if (!open || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeNote({ returnFocus: true });
  }

  function handleNoteBlur(event) {
    // Tabbing out of the note closes it; focus moving back to the trigger
    // keeps it open for a second read.
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
        aria-controls={open ? noteId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="How filters combine"
        className="table-filter-help"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        ref={buttonRef}
        type="button"
      >
        ?
      </button>
      {open
        ? createPortal(
            <div
              aria-label="How filters combine"
              className="table-filter-menu table-filter-menu--note"
              id={noteId}
              onBlur={handleNoteBlur}
              onKeyDown={handleKeyDown}
              ref={menuRef}
              role="dialog"
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
              }}
              tabIndex={-1}
            >
              {
                "No filters yet — pick a field, type, press ⏎. Same field ORs, different fields AND."
              }
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
}
