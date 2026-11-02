import { Fragment, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../lib/useAnchoredPopover.js";

// The shared shell for the table's rail and column menus. It owns the
// scaffold the three of them used to repeat: the trigger's aria wiring, the
// panel portalled into <body> so the table's scroll containers cannot clip it,
// blur and outside-press dismissal, and Escape closing the panel and returning
// focus to the trigger. Callers own only what differs: the trigger's look, the
// panel's label and class, and any arrow-key handling inside the panel.
//
// `role` is the panel's role and also its `aria-haspopup` token, so it may
// only be "dialog" or "menu". `renderTrigger` receives `{ open, triggerProps }`:
// spread `triggerProps` on the trigger button and nothing else about open
// state needs wiring. `initialFocus(panel)` names the control to focus when
// the panel opens; the panel itself is the fallback. `children` may be a
// function that receives `{ close }` when a control inside the panel has to
// dismiss it; that close leaves focus where the caller puts it.
export function AnchoredPopover({
  children,
  className,
  initialFocus,
  panelLabel,
  onKeyDown,
  renderTrigger,
  role = "dialog",
}) {
  const { buttonRef, menuRef, open, openPopover, position, setOpen } =
    useAnchoredPopover();
  const panelId = useId();
  // The callbacks are read when the panel opens, not when it renders, so a
  // caller can pass a fresh arrow function without re-running the focus move
  // on every render.
  const initialFocusRef = useRef(initialFocus);
  const panelKeyDownRef = useRef(onKeyDown);

  useEffect(() => {
    initialFocusRef.current = initialFocus;
    panelKeyDownRef.current = onKeyDown;
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const panel = menuRef.current;

    if (!panel) {
      return;
    }

    // Focusing the panel keeps Escape and Tab working before the caller's
    // first control exists or takes focus.
    (initialFocusRef.current?.(panel) ?? panel).focus();
  }, [menuRef, open]);

  function closePanel({ returnFocus = false } = {}) {
    setOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    openPopover();
  }

  function handleTriggerKeyDown(event) {
    // The trigger owns Escape only while the panel is open, where closing it
    // is the first step. Closed, leaving the event alone lets the table's
    // chrome rule clear a selection or a filter, as it does for the rest of
    // the rail.
    if (!open || event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closePanel({ returnFocus: true });
  }

  function handlePanelKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel({ returnFocus: true });
      return;
    }

    // The caller navigates inside the panel it was handed; the shell keeps
    // the ref so the trigger's aria can point at the same element.
    panelKeyDownRef.current?.(event, menuRef.current);
  }

  function handlePanelBlur(event) {
    // Tabbing out of the panel closes it; focus moving between its controls,
    // or back to the trigger for a second look, stays inside.
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
      {renderTrigger({
        open,
        triggerProps: {
          "aria-controls": open ? panelId : undefined,
          "aria-expanded": open,
          "aria-haspopup": role,
          onClick: toggle,
          onKeyDown: handleTriggerKeyDown,
          ref: buttonRef,
        },
      })}
      {open
        ? createPortal(
            <div
              aria-label={panelLabel}
              className={className}
              id={panelId}
              onBlur={handlePanelBlur}
              onKeyDown={handlePanelKeyDown}
              ref={menuRef}
              role={role}
              style={{
                left: position?.left ?? 0,
                top: position?.top ?? 0,
              }}
              tabIndex={-1}
            >
              {typeof children === "function"
                ? children({ close: () => setOpen(false) })
                : children}
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
}
