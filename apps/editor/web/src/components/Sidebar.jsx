import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "../lib/routes.js";

// The Editor's persistent chrome. It renders on every route beside the main
// region: a 64px rail of destination icons that expands to 288px on hover or
// keyboard focus, and becomes an overlay drawer on narrow screens.
//
// Keyboard model (matches the tables): with nothing focused, "b" opens the
// rail and puts the cursor on the current option. ↑/↓ and j/k move the cursor;
// Home/End jump; Enter follows the option; Escape returns focus to the page and
// collapses the rail. Tab still reaches every option, and leaving the rail
// collapses it.

// Per-destination icons, lifted from the settled layout-D prototype.
const ICONS = {
  banknote:
    '<rect x="2.5" y="6" width="19" height="12" rx="2.3"/><circle cx="12" cy="12" r="2.6"/><path d="M6.2 9.6h.01M17.8 14.4h.01"/>',
  folder:
    '<path d="M3.5 7.2c0-.9.8-1.7 1.7-1.7h3.2c.5 0 1 .2 1.3.6l.9 1h7.2c.9 0 1.7.8 1.7 1.7v7.4c0 .9-.8 1.7-1.7 1.7H5.2c-.9 0-1.7-.8-1.7-1.7z"/>',
  swap: '<path d="M7.5 4.5v13M7.5 4.5 4.6 7.6M7.5 4.5l2.9 3.1M16.5 19.5v-13M16.5 19.5l2.9-3.1M16.5 19.5l-2.9-3.1"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  layers:
    '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3.8 12.2 12 16.3l8.2-4.1"/><path d="M3.8 16.2 12 20.3l8.2-4.1"/>',
};

const CATALOG_GROUP = {
  id: "catalog",
  items: [
    {
      icon: "banknote",
      label: "Banknotes",
      to: CATALOG_ROUTES.banknotes,
      // The note editor is a Catalog > Banknotes child, so it keeps the
      // Banknotes destination highlighted.
      matches: (pathname) =>
        pathname === CATALOG_ROUTES.banknotes ||
        pathname.startsWith("/catalog/notes/"),
    },
    { icon: "folder", label: "Collections", to: CATALOG_ROUTES.collections },
    { icon: "swap", label: "Import / Export", to: CATALOG_ROUTES.importExport },
  ],
};

const PORTFOLIO_GROUP = {
  id: "portfolio",
  items: [
    { icon: "grid", label: "Categories", to: PORTFOLIO_ROUTES.categories },
    { icon: "layers", label: "Groupings", to: PORTFOLIO_ROUTES.groupings },
  ],
};

const GROUPS = [CATALOG_GROUP, PORTFOLIO_GROUP];
const LINKS = [...CATALOG_GROUP.items, ...PORTFOLIO_GROUP.items];

function isItemActive(item, pathname) {
  if (item.matches) {
    return item.matches(pathname);
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function ItemIcon({ icon }) {
  return (
    <span aria-hidden="true" className="sidebar-ic">
      <svg
        dangerouslySetInnerHTML={{ __html: ICONS[icon] }}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
        viewBox="0 0 24 24"
      />
    </span>
  );
}

function HamburgerIcon() {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function Sidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The keyboard cursor, distinct from DOM focus. Null means the rail is not
  // being navigated by keyboard.
  const [cursorIndex, setCursorIndex] = useState(null);
  const navRef = useRef(null);
  const linksRef = useRef([]);
  const hamburgerRef = useRef(null);

  function closeDrawer({ restoreFocus = false } = {}) {
    setDrawerOpen(false);

    if (restoreFocus) {
      hamburgerRef.current?.focus();
    }
  }

  function openCursor() {
    navRef.current?.focus({ preventScroll: true });

    if (cursorIndex !== null) {
      return;
    }

    const activeIndex = LINKS.findIndex((item) => isItemActive(item, pathname));
    setCursorIndex(activeIndex === -1 ? 0 : activeIndex);
  }

  function leaveCursor() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setCursorIndex(null);
  }

  // Move DOM focus with the cursor so Tab/Escape and screen readers track it.
  useEffect(() => {
    if (cursorIndex === null) {
      return;
    }

    linksRef.current[cursorIndex]?.focus();
  }, [cursorIndex]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target;
      const inSidebar =
        target instanceof Node && navRef.current?.contains(target);

      if (!inSidebar) {
        // "b" opens the rail unless something else owns the keyboard. The
        // tables keep their own keys, so bail when focus sits in an editable
        // field, inside a table, or on any other focusable control.
        const active = document.activeElement;
        const ownsKeyboard =
          active instanceof HTMLElement &&
          active.closest(
            "input, textarea, select, [contenteditable], button, a, table, .table-shell, [role='dialog']",
          );

        if (!ownsKeyboard && event.key === "b") {
          event.preventDefault();
          openCursor();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        leaveCursor();
        return;
      }

      if (event.key === "Tab") {
        const atStart = cursorIndex === 0;
        const atEnd = cursorIndex === LINKS.length - 1;

        if ((event.shiftKey && atStart) || (!event.shiftKey && atEnd)) {
          // Returning to the page closes the rail and hands focus back.
          event.preventDefault();
          leaveCursor();
        }
        return;
      }

      const count = LINKS.length;

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setCursorIndex((current) =>
          current === null ? 0 : (current + 1) % count,
        );
        return;
      }

      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setCursorIndex((current) =>
          current === null ? 0 : (current - 1 + count) % count,
        );
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        setCursorIndex(0);
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        setCursorIndex(count - 1);
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();

        if (cursorIndex !== null) {
          navigate(LINKS[cursorIndex].to);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex, pathname]);

  // Escape closes the narrow-screen drawer and returns focus to the page.
  useEffect(() => {
    if (!drawerOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer({ restoreFocus: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

  function handleLinkClick() {
    closeDrawer();
    setCursorIndex(null);
  }

  const dockClassName = `sidebar-dock${drawerOpen ? " sidebar-dock--drawer-open" : ""}`;
  const drawerLabel = drawerOpen ? "Close navigation" : "Open navigation";

  return (
    <>
      <button
        aria-controls="app-sidebar"
        aria-expanded={drawerOpen}
        aria-label={drawerLabel}
        className="sidebar-hamburger"
        onClick={() => setDrawerOpen((open) => !open)}
        ref={hamburgerRef}
        type="button"
      >
        <HamburgerIcon />
      </button>

      {drawerOpen ? (
        <div
          aria-hidden="true"
          className="sidebar-backdrop"
          onClick={() => closeDrawer({ restoreFocus: true })}
        />
      ) : null}

      <div className={dockClassName}>
        <nav
          aria-label="Sections"
          className="sidebar"
          id="app-sidebar"
          onBlur={(event) => {
            if (
              cursorIndex !== null &&
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setCursorIndex(null);
            }
          }}
          ref={navRef}
          tabIndex="-1"
        >
          <div className="sidebar-head">
            <div className="sidebar-brand">
              <span aria-hidden="true" className="sidebar-mark">
                <ItemIcon icon="banknote" />
              </span>
              <span className="sidebar-wordmark">Note Harbor</span>
            </div>
          </div>

          <div className="sidebar-nav">
            {GROUPS.map((group) => (
              <div
                aria-labelledby={`sidebar-group-${group.id}`}
                className="sidebar-group"
                key={group.id}
                role="group"
              >
                <p
                  className="sidebar-group-label"
                  id={`sidebar-group-${group.id}`}
                >
                  {group.label}
                </p>
                <div className="sidebar-group-links">
                  {group.items.map((item) => {
                    const index = LINKS.indexOf(item);
                    const active = isItemActive(item, pathname);

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        className={`sidebar-link${active ? " sidebar-link--active" : ""}${
                          cursorIndex === index ? " sidebar-link--cursor" : ""
                        }`}
                        data-sidebar-index={index}
                        key={item.to}
                        onClick={handleLinkClick}
                        ref={(node) => {
                          linksRef.current[index] = node;
                        }}
                        title={item.label}
                        to={item.to}
                      >
                        <ItemIcon icon={item.icon} />
                        <span className="sidebar-link-label">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      </div>
    </>
  );
}

export { Sidebar };
