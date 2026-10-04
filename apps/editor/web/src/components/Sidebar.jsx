import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  PORTFOLIO_ROUTES,
} from "../lib/routes.js";

// The Editor's persistent chrome. It renders on every route beside the main
// region: a 64px rail of destination icons that expands to 288px on hover or
// keyboard focus, and becomes an overlay drawer on narrow screens.
//
// Keyboard model (matches the tables): with nothing focused, "b" opens the
// rail and puts the cursor on the current option. ↑/↓ and j/k move the cursor;
// Home/End jump; Enter follows the option; Escape returns focus to the page and
// collapses the rail. Tab cycles the options like ↓, and Shift+Tab like ↑, both
// wrapping off the ends, so the rail is left with Escape.

// Per-destination icons, lifted from the settled layout-D prototype.
const ICONS = {
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  folders:
    '<path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z"/><path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1"/>',
  swap: '<path d="M7.5 4.5v13M7.5 4.5 4.6 7.6M7.5 4.5l2.9 3.1M16.5 19.5v-13M16.5 19.5l2.9-3.1M16.5 19.5l-2.9-3.1"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  layers:
    '<path d="M12 3.5 21 8l-9 4.5L3 8z"/><path d="M3.8 12.2 12 16.3l8.2-4.1"/><path d="M3.8 16.2 12 20.3l8.2-4.1"/>',
  // Section markers for the two sidebar categories. They read as hubs, not
  // as destinations: a stack of books for Catalog, a pile of pictures for
  // Portfolio. Both are Lucide glyphs, matching the destination icons.
  catalog:
    '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  portfolio:
    '<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/>',
};

const CATALOG_GROUP = {
  id: "catalog",
  icon: "catalog",
  label: "Catalog",
  items: [
    {
      icon: "banknote",
      label: "Banknotes",
      to: DEFAULT_DESTINATION,
      // The note editor is a Catalog > Banknotes child, so it keeps the
      // Banknotes destination highlighted.
      matches: (pathname) =>
        pathname === DEFAULT_DESTINATION ||
        pathname.startsWith("/catalog/notes/"),
    },
    { icon: "folders", label: "Collections", to: CATALOG_ROUTES.collections },
    { icon: "swap", label: "Import / Export", to: CATALOG_ROUTES.importExport },
  ],
};

const PORTFOLIO_GROUP = {
  id: "portfolio",
  icon: "portfolio",
  label: "Portfolio",
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

function ItemIcon({ className = "sidebar-ic", icon }) {
  return (
    <span aria-hidden="true" className={className}>
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

function Sidebar({ pageFocusRef }) {
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

  // Leaving the rail hands focus back to the page content. The shell puts an
  // inert focus anchor at the top of <main>, so focus lands inside the page
  // rather than on <body>; Tab then continues from there.
  function leaveCursor() {
    setCursorIndex(null);

    if (pageFocusRef?.current) {
      pageFocusRef.current.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
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
      // Shift is part of Shift+Tab, which the rail handles; every other
      // shifted key is left to the browser.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.shiftKey && event.key !== "Tab")
      ) {
        return;
      }

      const target = event.target;
      const inSidebar =
        target instanceof Node && navRef.current?.contains(target);

      if (!inSidebar) {
        // "b" opens the rail unless something else owns the keyboard. The
        // tables keep their own keys, so bail when focus sits in an editable
        // field, on a table row, or on any other focusable control. "Inside a
        // table" is matched via the <table> itself: the shell's inert
        // `.table-focus-anchor`, where focus rests after Escape clears a row
        // cursor, sits beside the <table>, so that empty-row state still reads
        // as "nothing focused" and "b" opens the rail.
        const active = document.activeElement;
        const ownsKeyboard =
          active instanceof HTMLElement &&
          active.closest(
            "input, textarea, select, [contenteditable], button, a, table, [role='dialog']",
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

      const count = LINKS.length;
      // Tab only takes over once the cursor is active ("b" opened the rail);
      // otherwise it keeps its native tab order. With the cursor on, Tab
      // mirrors the arrows and wraps off the ends, so Escape is the way out.
      const tabActive = event.key === "Tab" && cursorIndex !== null;
      const forward =
        event.key === "ArrowDown" ||
        event.key === "j" ||
        (tabActive && !event.shiftKey);
      const backward =
        event.key === "ArrowUp" ||
        event.key === "k" ||
        (tabActive && event.shiftKey);

      if (forward) {
        event.preventDefault();
        setCursorIndex((current) =>
          current === null ? 0 : (current + 1) % count,
        );
        return;
      }

      if (backward) {
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
    // A click means "I'm leaving the rail". The browser focuses a clicked
    // link, so without this the collapsed rail would keep keyboard focus and
    // claim the arrow keys. Close the drawer and hand focus to the page.
    closeDrawer();
    leaveCursor();
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
                  <ItemIcon className="sidebar-group-ic" icon={group.icon} />
                  <span className="sidebar-group-name">{group.label}</span>
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
