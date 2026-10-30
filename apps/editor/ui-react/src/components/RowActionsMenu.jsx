import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";

// Gap between the button and the floating menu, and the margin the menu keeps
// from the viewport edges when it flips or slides into view.
const menuOffset = 6;
const viewportMargin = 12;

// A row's actions button and its menu. The menu is portalled into <body> and
// positioned from the button's viewport rect, so the table's scroll containers
// can never clip it. Open state, focus return and dismissal live here; the
// caller supplies the items (label, handler, optional href).
export function RowActionsMenu({ items, label }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  // Which item receives focus when the menu opens: the menu button opens on
  // the first item, ArrowUp opens on the last.
  const initialFocusRef = useRef("first");
  const menuId = useId();
  const location = useLocation();
  const locationKey = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    // A route change means the row (or the whole screen) moved on; a menu
    // pinned to the old button would float over the new screen.
    setOpen(false);
  }, [locationKey]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    function closeOnOutsidePress(event) {
      if (menuRef.current?.contains(event.target)) {
        return;
      }

      if (buttonRef.current?.contains(event.target)) {
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
      top = Math.max(viewportMargin, buttonRect.top - menuRect.height - menuOffset);
    }

    const left = Math.min(
      Math.max(viewportMargin, buttonRect.right - menuRect.width),
      Math.max(viewportMargin, window.innerWidth - menuRect.width - viewportMargin),
    );

    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const menuItems = menuRef.current?.querySelectorAll('[role="menuitem"]');

    if (!menuItems?.length) {
      return;
    }

    const target =
      initialFocusRef.current === "last"
        ? menuItems[menuItems.length - 1]
        : menuItems[0];
    initialFocusRef.current = "first";
    target.focus();
  }, [open]);

  function openMenu(initialFocus) {
    initialFocusRef.current = initialFocus;
    setOpen(true);
  }

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
        className={`row-menu-btn${open ? " is-open" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu("first");
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            openMenu("last");
          }
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
                      {item.label}
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
                      {item.label}
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
}
