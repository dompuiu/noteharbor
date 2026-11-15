import { Fragment, forwardRef } from "react";
import { handleMenuNavigation } from "../lib/menuNavigation.js";
import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { MenuIcon } from "./MenuIcon.jsx";

// A row's (or a Note image card's) three-dot button and its menu. The shared
// popover shell owns the trigger's aria, the portal, positioning, focus return
// and every dismissal rule; this file supplies only the trigger's look, the
// caller's label, and the menu items it hands in (label, handler, optional
// href and icon). The ref exposes `{ open }` for the table's `o` shortcut.
export const ActionsMenu = forwardRef(function ActionsMenu(
  { items, label, shortcut },
  ref,
) {
  return (
    <AnchoredPopover
      // In the table, the actions column is the last, unpinned column, so on
      // a narrow window its button can be scrolled out of view. Opening from
      // the keyboard has to bring it back first, or the menu anchors to a
      // button the collector cannot see.
      align="end"
      className="row-actions-menu"
      closeOnRouteChange
      initialFocus={(panel) =>
        panel.querySelector('[role="menuitem"]:not(:disabled)')
      }
      onKeyDown={(event, panel) =>
        handleMenuNavigation(event, panel, '[role="menuitem"]')
      }
      panelLabel={label}
      ref={ref}
      renderTrigger={({ open, triggerProps }) => (
        <button
          {...triggerProps}
          aria-keyshortcuts={shortcut}
          aria-label={label}
          className={`row-menu-btn${open ? " is-open" : ""}`}
          // In the table, the trigger sits inside the row, whose click opens
          // the note slideshow. The shell's toggle stays the open path; the
          // row just must not also see the press.
          onClick={(event) => {
            event.stopPropagation();
            triggerProps.onClick(event);
          }}
          type="button"
        >
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            <circle cx="5" cy="12" fill="currentColor" r="2" />
            <circle cx="12" cy="12" fill="currentColor" r="2" />
            <circle cx="19" cy="12" fill="currentColor" r="2" />
          </svg>
        </button>
      )}
      revealOnOpen
      role="menu"
    >
      {({ close }) => (
        <>
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separated ? (
                <div className="row-actions-menu-separator" role="separator" />
              ) : null}
              {item.href ? (
                <a
                  className="row-actions-menu-item"
                  data-shortcut={item.shortcut}
                  href={item.href}
                  onClick={(event) => {
                    event.stopPropagation();
                    close();
                  }}
                  rel="noreferrer"
                  role="menuitem"
                  target="_blank"
                >
                  <MenuIcon name={item.icon} />
                  <span>{item.label}</span>
                </a>
              ) : (
                <button
                  className={`row-actions-menu-item${item.danger ? " row-actions-menu-item--danger" : ""}`}
                  data-shortcut={item.shortcut}
                  disabled={item.disabled}
                  onClick={(event) => {
                    // React portals bubble through the component tree, so
                    // the menu item's click would otherwise reach the row
                    // that owns this button and open the slideshow.
                    event.stopPropagation();
                    close();
                    item.onSelect?.();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <MenuIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              )}
            </Fragment>
          ))}
        </>
      )}
    </AnchoredPopover>
  );
});
