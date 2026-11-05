import { Fragment, forwardRef } from "react";
import { handleMenuNavigation } from "../lib/menuNavigation.js";
import { AnchoredPopover } from "./AnchoredPopover.jsx";

// The glyphs stay in one place so every menu item's icon shares the same
// 24-unit box, stroke weight and cap style. Items name one through `icon`.
const ACTION_ICONS = {
  open: (
    <>
      <path
        d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <circle
        cx="12"
        cy="12"
        fill="none"
        r="3"
        stroke="currentColor"
        strokeWidth="2"
      />
    </>
  ),
  edit: (
    <>
      <path
        d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M13.5 6.5l3 3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  copy: (
    <>
      <rect
        fill="none"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        width="11"
        x="9"
        y="9"
      />
      <path
        d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  insert: (
    <>
      <path
        d="M12 4v10M7 9h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M5 19h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </>
  ),
  source: (
    <>
      <path
        d="M14 4h6v6M20 4l-9 9"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  move: (
    <>
      <path
        d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M12 16v-5m0 0-2.5 2.5M12 11l2.5 2.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
  "arrow-up": (
    <path
      d="M12 19V5m0 0-6 6m6-6 6 6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  ),
  "arrow-down": (
    <path
      d="M12 5v14m0 0-6-6m6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    />
  ),
  delete: (
    <>
      <path
        d="M5 7h14"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <path
        d="M9 7V5h6v2"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M8 7l1 12h6l1-12"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </>
  ),
};

function ActionIcon({ name }) {
  const glyph = ACTION_ICONS[name];

  if (!glyph) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      className="row-actions-menu-icon"
      focusable="false"
      height="16"
      viewBox="0 0 24 24"
      width="16"
    >
      {glyph}
    </svg>
  );
}

// A row's actions button and its menu. The shared popover shell owns the
// trigger's aria, the portal, positioning, focus return and every dismissal
// rule; this file supplies only the trigger's look, the note-specific label,
// and the menu items the caller hands in (label, handler, optional href, icon).
// The ref exposes `{ open }` for the table's `o` shortcut.
export const RowActionsMenu = forwardRef(function RowActionsMenu(
  { items, label, shortcut },
  ref,
) {
  return (
    <AnchoredPopover
      // The actions column is the table's last, unpinned column, so on a
      // narrow window its button can be scrolled out of view. Opening from
      // the keyboard has to bring it back first, or the menu anchors to a
      // button the collector cannot see.
      align="end"
      className="row-actions-menu"
      closeOnRouteChange
      initialFocus={(panel) => panel.querySelector('[role="menuitem"]')}
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
          // The trigger sits inside the row, whose click opens the note
          // slideshow. The shell's toggle stays the open path; the row just
          // must not also see the press.
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
                  <ActionIcon name={item.icon} />
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
                  <ActionIcon name={item.icon} />
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
