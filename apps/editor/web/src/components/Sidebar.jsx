import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "../lib/routes.js";

// The Editor's persistent chrome. It renders on every route beside the main
// region: a 64px rail that expands to 288px on hover or keyboard focus and
// becomes an overlay drawer on narrow screens. It owns its own drawer state so
// the shell only has to place it.
const SIDEBAR_GROUPS = [
  {
    id: "catalog",
    label: "Catalog",
    items: [
      {
        label: "Banknotes",
        to: CATALOG_ROUTES.banknotes,
        // The note editor is a Catalog > Banknotes child, so it keeps the
        // Banknotes destination highlighted.
        matches: (pathname) =>
          pathname === CATALOG_ROUTES.banknotes ||
          pathname.startsWith("/catalog/notes/"),
      },
      { label: "Collections", to: CATALOG_ROUTES.collections },
      { label: "Import / Export", to: CATALOG_ROUTES.importExport },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    items: [
      { label: "Categories", to: PORTFOLIO_ROUTES.categories },
      { label: "Groupings", to: PORTFOLIO_ROUTES.groupings },
    ],
  },
];

function isItemActive(item, pathname) {
  if (item.matches) {
    return item.matches(pathname);
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function NoteHarborMark() {
  return (
    <svg
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <rect height="12" rx="2.3" width="19" x="2.5" y="6" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.2 9.6h.01M17.8 14.4h.01" />
    </svg>
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hamburgerRef = useRef(null);

  function closeDrawer({ restoreFocus = false } = {}) {
    setDrawerOpen(false);

    if (restoreFocus) {
      hamburgerRef.current?.focus();
    }
  }

  useEffect(() => {
    if (!drawerOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeDrawer({ restoreFocus: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen]);

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
        <nav aria-label="Sections" className="sidebar" id="app-sidebar">
          <div className="sidebar-head">
            <div className="sidebar-brand">
              <span aria-hidden="true" className="sidebar-mark">
                <NoteHarborMark />
              </span>
              {/* The wordmark only appears once the rail expands. */}
              <span className="sidebar-wordmark">Note Harbor</span>
            </div>
          </div>

          <div className="sidebar-nav">
            {SIDEBAR_GROUPS.map((group) => (
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
                    const active = isItemActive(item, pathname);

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={`sidebar-link${active ? " sidebar-link--active" : ""}`}
                        key={item.to}
                        onClick={() => closeDrawer()}
                        to={item.to}
                      >
                        {item.label}
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
