import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCollections } from "../lib/collections.jsx";
import { useShowcases } from "../lib/showcases.jsx";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  NEW_COLLECTION_ID,
  NEW_SHOWCASE_ID,
  SHOWCASE_ROUTES,
} from "../lib/routes.js";

// The Editor's persistent chrome. It renders on every route beside the main
// region: a 64px rail of destination icons that expands to 288px on hover or
// keyboard focus. The layout holds a fixed 1200px desktop floor, so the rail
// never becomes a drawer: narrow windows scroll horizontally instead.
//
// The Catalog group is data-driven for collections (the sidebar *is* the
// collection list): Banknotes, one row per collection, a `+ New collection`
// action above Import / Export. The Showcases group is data-driven the same
// way: one row per showcase plus a `+ New showcase` action. Both create
// actions stage a draft row and open its edit canvas; nothing POSTs until
// Save, and Cancel or leaving the route discards the draft.
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
  plus: '<path d="M12 5v14M5 12h14"/>',
  // Section markers for the two sidebar categories. They read as hubs, not
  // as destinations: a stack of books for Catalog, a grid for Showcases. Both
  // are Lucide glyphs, matching the destination icons. Individual showcases
  // use the pile-of-pictures glyph so each row reads as a showcase.
  catalog:
    '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  showcases:
    '<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/>',
};

const BANKNOTES_ITEM = {
  icon: "banknote",
  key: "banknotes",
  label: "Banknotes",
  to: DEFAULT_DESTINATION,
  // The note editor is a Catalog > Banknotes child, so it keeps the
  // Banknotes destination highlighted.
  matches: (pathname) =>
    pathname === DEFAULT_DESTINATION ||
    pathname.startsWith("/catalog/notes/"),
};

const IMPORT_EXPORT_ITEM = {
  icon: "swap",
  key: "import-export",
  label: "Import / Export",
  to: CATALOG_ROUTES.importExport,
};

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

function Sidebar({ pageFocusRef }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const {
    showcases,
    pendingShowcase,
    beginPendingShowcase,
    discardPendingShowcase,
    reorderShowcases,
  } = useShowcases();
  const {
    collections,
    pendingCollection,
    beginPendingCollection,
    discardPendingCollection,
    reorderCollections,
  } = useCollections();
  // The keyboard cursor, distinct from DOM focus. Null means the rail is not
  // being navigated by keyboard.
  const [cursorIndex, setCursorIndex] = useState(null);
  // Drag-and-drop state for reordering the showcase rows. `dropTarget` records
  // whether the pointer sits above or below the hovered row's midpoint.
  const [draggedShowcaseId, setDraggedShowcaseId] = useState(null);
  const [showcaseDropTarget, setShowcaseDropTarget] = useState(null);
  // Drag-and-drop state for reordering the collection rows, mirroring
  // showcases. The sidebar never reorders its own copy; the provider applies
  // the server's order.
  const [draggedCollectionId, setDraggedCollectionId] = useState(null);
  const [collectionDropTarget, setCollectionDropTarget] = useState(null);
  const navRef = useRef(null);
  const linksRef = useRef([]);

  // The collection rows sit inside the Catalog group, above Import / Export.
  // A collection row stays highlighted in both of its modes: view and edit
  // are siblings under the collection. A pending (not-yet-saved) collection
  // renders as a draft row that vanishes on Cancel or on leaving its route.
  const collectionItems = collections.map((collection) => ({
    icon: "banknote",
    key: `collection-${collection.id}`,
    label: collection.name,
    to: CATALOG_ROUTES.collection(collection.id),
    matches: (pathname) =>
      pathname === CATALOG_ROUTES.collection(collection.id) ||
      pathname === CATALOG_ROUTES.collectionEdit(collection.id),
    collectionId: collection.id,
  }));

  if (pendingCollection) {
    collectionItems.push({
      icon: "banknote",
      key: "collection-new",
      label: pendingCollection.name,
      to: CATALOG_ROUTES.collectionEdit(NEW_COLLECTION_ID),
      matches: (pathname) =>
        pathname === CATALOG_ROUTES.collectionEdit(NEW_COLLECTION_ID),
      collectionId: NEW_COLLECTION_ID,
      pending: true,
    });
  }

  const newCollectionItem = {
    icon: "plus",
    key: "new-collection",
    label: "New collection",
    type: "action",
    actionKind: "new-collection",
    visibleLabel: "New collection",
  };

  // The showcase rows, then the create action, hang off the Showcases group.
  // A showcase row stays highlighted in both of its modes: view and edit are
  // siblings under the showcase, so a prefix check on the view URL no longer
  // covers the edit one. A pending (not-yet-saved) showcase renders as a draft
  // row that vanishes on Cancel or on leaving its route.
  const showcaseItems = showcases.map((showcase) => ({
    icon: "showcases",
    key: `showcase-${showcase.id}`,
    label: showcase.name,
    to: SHOWCASE_ROUTES.showcase(showcase.id),
    matches: (pathname) =>
      pathname === SHOWCASE_ROUTES.showcase(showcase.id) ||
      pathname === SHOWCASE_ROUTES.showcaseEdit(showcase.id),
    showcaseId: showcase.id,
  }));

  if (pendingShowcase) {
    showcaseItems.push({
      icon: "showcases",
      key: "showcase-new",
      label: pendingShowcase.name,
      to: SHOWCASE_ROUTES.showcaseEdit(NEW_SHOWCASE_ID),
      matches: (pathname) =>
        pathname === SHOWCASE_ROUTES.showcaseEdit(NEW_SHOWCASE_ID),
      showcaseId: NEW_SHOWCASE_ID,
      pending: true,
    });
  }

  const newShowcaseItem = {
    icon: "plus",
    key: "new-showcase",
    label: "New showcase",
    type: "action",
    actionKind: "new-showcase",
    visibleLabel: "New showcase",
  };

  const groups = [
    {
      id: "catalog",
      icon: "catalog",
      label: "Catalog",
      items: [
        BANKNOTES_ITEM,
        ...collectionItems,
        newCollectionItem,
        IMPORT_EXPORT_ITEM,
      ],
    },
    {
      id: "showcases",
      icon: "grid",
      label: "Showcases",
      items: [...showcaseItems, newShowcaseItem],
    },
  ];

  // One flat list drives the keyboard cursor, in DOM order.
  const entries = groups.flatMap((group) => group.items);

  const newShowcaseTo = SHOWCASE_ROUTES.showcaseEdit(NEW_SHOWCASE_ID);
  const newCollectionTo = CATALOG_ROUTES.collectionEdit(NEW_COLLECTION_ID);

  function handleNewShowcase() {
    // Deferred creation: stage a draft row and open its edit canvas. Nothing
    // POSTs until Save; Cancel or leaving the route discards the draft.
    beginPendingShowcase();
    navigate(newShowcaseTo, {
      state: { justCreated: true },
    });
  }

  function handleNewCollection() {
    // Deferred creation, mirroring showcases: stage a draft row and open its
    // edit canvas. Nothing POSTs until Save; Cancel or leaving the route
    // discards the draft.
    beginPendingCollection();
    navigate(newCollectionTo, {
      state: { justCreated: true },
    });
  }

  function handleActionClick(item) {
    if (item?.actionKind === "new-collection") {
      handleNewCollection();
    } else {
      handleNewShowcase();
    }
    leaveCursor();
  }

  function openCursor() {
    navRef.current?.focus({ preventScroll: true });

    if (cursorIndex !== null) {
      return;
    }

    const activeIndex = entries.findIndex(
      (item) => item.type !== "action" && isItemActive(item, pathname),
    );
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

      const count = entries.length;
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

        if (cursorIndex === null) {
          return;
        }

        const entry = entries[cursorIndex];

        if (entry?.type === "action") {
          if (entry?.actionKind === "new-collection") {
            handleNewCollection();
          } else {
            handleNewShowcase();
          }
        } else if (entry) {
          if (entry.to !== newShowcaseTo) {
            discardPendingShowcase();
          }
          if (entry.to !== newCollectionTo) {
            discardPendingCollection();
          }
          navigate(entry.to);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex, pathname, showcases, pendingShowcase, collections, pendingCollection]);

  function handleLinkClick(to) {
    // A click means "I'm leaving the rail". The browser focuses a clicked
    // link, so without this the collapsed rail would keep keyboard focus and
    // claim the arrow keys. Hand focus to the page. Leaving a draft route
    // discards a not-yet-saved row so it never lingers.
    if (to !== newShowcaseTo) {
      discardPendingShowcase();
    }
    if (to !== newCollectionTo) {
      discardPendingCollection();
    }
    leaveCursor();
  }

  // Any route change away from a draft (browser back, typed URL, Cancel's
  // own navigation already cleared it) drops the pending row. The effect only
  // watches the pathname so staging a draft and navigating to it in one
  // click never discards itself mid-flight.
  const pendingShowcaseRef = useRef(null);
  pendingShowcaseRef.current = pendingShowcase ? true : null;
  const pendingCollectionRef = useRef(null);
  pendingCollectionRef.current = pendingCollection ? true : null;
  useEffect(() => {
    if (pendingShowcaseRef.current && pathname !== newShowcaseTo) {
      discardPendingShowcase();
    }
    if (pendingCollectionRef.current && pathname !== newCollectionTo) {
      discardPendingCollection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  function clearShowcaseDrag() {
    setDraggedShowcaseId(null);
    setShowcaseDropTarget(null);
  }

  function handleShowcaseDragStart(event, showcaseId) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(showcaseId));
    setDraggedShowcaseId(showcaseId);
    setShowcaseDropTarget({ showcaseId, placement: "before" });
  }

  function updateShowcaseDropTarget(showcaseId, event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";

    setShowcaseDropTarget((current) =>
      current?.showcaseId === showcaseId && current?.placement === placement
        ? current
        : { showcaseId, placement },
    );
  }

  // Commit a drop by handing the new id order to the provider. The sidebar
  // never reorders its own copy; the provider applies the server's order, so a
  // failed request leaves the visible order untouched.
  async function handleShowcaseDrop(targetShowcaseId, placement) {
    if (draggedShowcaseId == null) {
      clearShowcaseDrag();
      return;
    }

    const startIndex = showcases.findIndex(
      (showcase) => showcase.id === draggedShowcaseId,
    );
    const targetIndex = showcases.findIndex(
      (showcase) => showcase.id === targetShowcaseId,
    );

    if (startIndex < 0 || targetIndex < 0) {
      clearShowcaseDrag();
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
      clearShowcaseDrag();
      return;
    }

    const nextShowcases = [...showcases];
    const [movedShowcase] = nextShowcases.splice(startIndex, 1);
    const insertIndex =
      startIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
    nextShowcases.splice(insertIndex, 0, movedShowcase);

    const unchanged = nextShowcases.every(
      (showcase, index) => showcase.id === showcases[index].id,
    );

    clearShowcaseDrag();

    if (unchanged) {
      return;
    }

    try {
      await reorderShowcases(nextShowcases.map((showcase) => showcase.id));
    } catch {
      // The rail cannot surface an error; the next load reconciles the order.
    }
  }

  function clearCollectionDrag() {
    setDraggedCollectionId(null);
    setCollectionDropTarget(null);
  }

  function handleCollectionDragStart(event, collectionId) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(collectionId));
    setDraggedCollectionId(collectionId);
    setCollectionDropTarget({ collectionId, placement: "before" });
  }

  function updateCollectionDropTarget(collectionId, event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";

    setCollectionDropTarget((current) =>
      current?.collectionId === collectionId && current?.placement === placement
        ? current
        : { collectionId, placement },
    );
  }

  async function handleCollectionDrop(targetCollectionId, placement) {
    if (draggedCollectionId == null) {
      clearCollectionDrag();
      return;
    }

    const startIndex = collections.findIndex(
      (collection) => collection.id === draggedCollectionId,
    );
    const targetIndex = collections.findIndex(
      (collection) => collection.id === targetCollectionId,
    );

    if (startIndex < 0 || targetIndex < 0) {
      clearCollectionDrag();
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
      clearCollectionDrag();
      return;
    }

    const nextCollections = [...collections];
    const [movedCollection] = nextCollections.splice(startIndex, 1);
    const insertIndex =
      startIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
    nextCollections.splice(insertIndex, 0, movedCollection);

    const unchanged = nextCollections.every(
      (collection, index) => collection.id === collections[index].id,
    );

    clearCollectionDrag();

    if (unchanged) {
      return;
    }

    try {
      await reorderCollections(nextCollections.map((collection) => collection.id));
    } catch {
      // The rail cannot surface an error; the next load reconciles the order.
    }
  }

  return (
    <div className="sidebar-dock">
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
            {groups.map((group) => (
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
                    const index = entries.indexOf(item);
                    const active =
                      item.type !== "action" && isItemActive(item, pathname);
                    // A pending draft row is display-only: it cannot be
                    // dragged or become a drop target.
                    const isShowcase = item.showcaseId != null && !item.pending;
                    const isCollection = item.collectionId != null && !item.pending;
                    const dropPlacement = isShowcase
                      ? (showcaseDropTarget?.showcaseId === item.showcaseId
                        ? showcaseDropTarget.placement
                        : null)
                      : isCollection
                        ? (collectionDropTarget?.collectionId === item.collectionId
                          ? collectionDropTarget.placement
                          : null)
                        : null;
                    const isDragging = isShowcase
                      ? draggedShowcaseId === item.showcaseId
                      : isCollection
                        ? draggedCollectionId === item.collectionId
                        : false;
                    const className = `sidebar-link${
                      active ? " sidebar-link--active" : ""
                    }${cursorIndex === index ? " sidebar-link--cursor" : ""}${
                      item.type === "action" ? " sidebar-link--action" : ""
                    }${
                      dropPlacement
                        ? ` sidebar-link--drop-${dropPlacement}`
                        : ""
                    }${
                      isDragging ? " sidebar-link--dragging" : ""
                    }`;

                    if (item.type === "action") {
                      return (
                        <button
                          aria-label={item.label}
                          className={className}
                          data-sidebar-index={index}
                          key={item.key}
                          onClick={() => handleActionClick(item)}
                          ref={(node) => {
                            linksRef.current[index] = node;
                          }}
                          title={item.label}
                          type="button"
                        >
                          <ItemIcon icon={item.icon} />
                          <span className="sidebar-link-label">
                            {item.visibleLabel ?? item.label}
                          </span>
                        </button>
                      );
                    }

                    const draggable = isShowcase || isCollection;

                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        className={className}
                        data-sidebar-index={index}
                        draggable={draggable}
                        key={item.key ?? item.to}
                        onClick={() => handleLinkClick(item.to)}
                        onDragEnd={draggable
                          ? (isShowcase ? clearShowcaseDrag : clearCollectionDrag)
                          : undefined}
                        onDragLeave={
                          draggable
                            ? (event) => {
                                const links = event.currentTarget.parentElement;

                                if (
                                  event.relatedTarget &&
                                  links?.contains(event.relatedTarget)
                                ) {
                                  return;
                                }

                                if (isShowcase) {
                                  setShowcaseDropTarget((current) =>
                                    current?.showcaseId === item.showcaseId
                                      ? null
                                      : current,
                                  );
                                } else {
                                  setCollectionDropTarget((current) =>
                                    current?.collectionId === item.collectionId
                                      ? null
                                      : current,
                                  );
                                }
                              }
                            : undefined
                        }
                        onDragOver={
                          draggable
                            ? (event) => {
                                if (isShowcase) {
                                  if (draggedShowcaseId == null) {
                                    return;
                                  }

                                  event.preventDefault();
                                  updateShowcaseDropTarget(
                                    item.showcaseId,
                                    event,
                                  );
                                } else {
                                  if (draggedCollectionId == null) {
                                    return;
                                  }

                                  event.preventDefault();
                                  updateCollectionDropTarget(
                                    item.collectionId,
                                    event,
                                  );
                                }
                              }
                            : undefined
                        }
                        onDragStart={
                          draggable
                            ? (event) => {
                                if (isShowcase) {
                                  handleShowcaseDragStart(event, item.showcaseId);
                                } else {
                                  handleCollectionDragStart(event, item.collectionId);
                                }
                              }
                            : undefined
                        }
                        onDrop={
                          draggable
                            ? (event) => {
                                event.preventDefault();
                                const bounds =
                                  event.currentTarget.getBoundingClientRect();
                                if (isShowcase) {
                                  const placement =
                                    showcaseDropTarget?.showcaseId ===
                                    item.showcaseId
                                      ? showcaseDropTarget.placement
                                      : event.clientY <
                                          bounds.top + bounds.height / 2
                                        ? "before"
                                        : "after";
                                  void handleShowcaseDrop(
                                    item.showcaseId,
                                    placement,
                                  );
                                } else {
                                  const placement =
                                    collectionDropTarget?.collectionId ===
                                    item.collectionId
                                      ? collectionDropTarget.placement
                                      : event.clientY <
                                          bounds.top + bounds.height / 2
                                        ? "before"
                                        : "after";
                                  void handleCollectionDrop(
                                    item.collectionId,
                                    placement,
                                  );
                                }
                              }
                            : undefined
                        }
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
  );
}

export { Sidebar };
