import {
  Fragment,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../lib/useAnchoredPopover.js";

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

// A row's actions button and its menu. The menu is portalled into <body> and
// positioned from the button's viewport rect, so the table's scroll containers
// can never clip it. Open state, focus return and dismissal live here; the
// caller supplies the items (label, handler, optional href, icon).
export const RowActionsMenu = forwardRef(function RowActionsMenu(
  { items, label, shortcut },
  ref,
) {
  const { buttonRef, menuRef, open, openPopover, position, setOpen } =
    useAnchoredPopover({
      align: "end",
      closeOnRouteChange: true,
      // The actions column is the table's last, unpinned column, so on a
      // narrow window its button can be scrolled out of view. Opening from
      // the keyboard has to bring it back first, or the menu anchors to a
      // button the collector cannot see.
      revealOnOpen: true,
    });
  const menuId = useId();

  useImperativeHandle(ref, () => ({ open: openPopover }), [openPopover]);

  useEffect(() => {
    if (!open) {
      return;
    }

    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [menuRef, open]);

  function closeMenu({ returnFocus }) {
    setOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  }

  function moveFocus(event, offset) {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll('[role="menuitem"]') ?? [],
    );

    if (!menuItems.length) {
      return;
    }

    // The menu is portalled, so the key would otherwise bubble through the
    // row's React tree into the table's roving-cursor shortcuts.
    event.preventDefault();
    event.stopPropagation();
    const currentIndex = menuItems.indexOf(document.activeElement);
    const nextIndex =
      (currentIndex + offset + menuItems.length) % menuItems.length;
    menuItems[nextIndex].focus();
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
      case "Home":
        event.preventDefault();
        event.stopPropagation();
        menuRef.current?.querySelector('[role="menuitem"]')?.focus();
        break;
      case "End": {
        event.preventDefault();
        event.stopPropagation();
        const menuItems = menuRef.current?.querySelectorAll('[role="menuitem"]');
        menuItems?.[menuItems.length - 1]?.focus();
        break;
      }
      default:
        break;
    }
  }

  function handleMenuBlur(event) {
    // Focus leaving the menu (Tab, or a click on a control elsewhere) closes
    // it. Focus moving between items stays inside the menu, so it is ignored.
    if (menuRef.current?.contains(event.relatedTarget)) {
      return;
    }

    setOpen(false);
  }

  function handleItemSelect(item) {
    setOpen(false);
    item.onSelect?.();
  }

  return (
    <Fragment>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        aria-keyshortcuts={shortcut}
        className={`row-menu-btn${open ? " is-open" : ""}`}
        onClick={(event) => {
          event.stopPropagation();

          if (open) {
            setOpen(false);
            return;
          }

          openPopover();
        }}
        ref={buttonRef}
        type="button"
      >
        <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
          <circle cx="5" cy="12" fill="currentColor" r="2" />
          <circle cx="12" cy="12" fill="currentColor" r="2" />
          <circle cx="19" cy="12" fill="currentColor" r="2" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              aria-label={label}
              className="row-actions-menu"
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
              {items.map((item) => (
                <Fragment key={item.key}>
                  {item.separated ? (
                    <div
                      className="row-actions-menu-separator"
                      role="separator"
                    />
                  ) : null}
                  {item.href ? (
                    <a
                      className="row-actions-menu-item"
                      data-shortcut={item.shortcut}
                      href={item.href}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpen(false);
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
                      onClick={(event) => {
                        // React portals bubble through the component tree,
                        // so the menu item's click would otherwise reach the
                        // row that owns this button and open the slideshow.
                        event.stopPropagation();
                        handleItemSelect(item);
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
            </div>,
            document.body,
          )
        : null}
    </Fragment>
  );
});
