import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useCollections } from "../lib/collections.jsx";
import { ownsPrintableShortcut } from "../lib/editableElement.js";
import { useShowcases } from "../lib/showcases.jsx";
import { loadSidebarPinned, saveSidebarPinned } from "../lib/sidebarPin.js";
import { APP_VERSION } from "../lib/version.js";
import { useToastHost } from "./Toast.jsx";
import {
  CATALOG_ROUTES,
  NEW_COLLECTION_ID,
  NEW_SHOWCASE_ID,
  SHOWCASE_ROUTES,
} from "../lib/routes.js";

// The Editor's persistent chrome. It renders on every route beside the main
// region: a 64px rail of destination icons that expands to 288px on hover or
// keyboard focus. The layout holds a fixed 1200px desktop floor, so the rail
// never becomes a drawer: narrow windows scroll horizontally instead. The pin
// in the head holds the expanded width without hover or focus, and then takes
// that width out of the main column's flow so the table reflows beside it.
//
// Collapsed, each collection and showcase row keeps its glyph and gains a
// second line of identity under it: the row's note count in tabular figures,
// or the name's initials when no count has loaded. Hover still reveals the
// full name, but it is confirmation rather than the only source of truth.
//
// The Catalog group is data-driven for collections (the sidebar *is* the
// collection list): one row per collection, a `+ New collection`
// action above Import / Export. The Showcases group is data-driven the same
// way: one row per showcase plus a `+ New showcase` action. Both create
// actions stage a draft row and open its edit canvas; nothing POSTs until
// Save, and Cancel or leaving the route discards the draft.
//
// Keyboard model (matches the tables): "b" is global — from a row, the
// selection bar, or any other control — and opens the rail with the cursor on
// the current option. Text fields and modal surfaces keep the letter.
// ↑/↓ and j/k move the cursor through every stop in DOM order — the pin
// toggle, then each row link/action; Home/End jump; Enter/Space activates the
// stop (pins the rail or follows the option); Escape returns focus to the
// control that opened the rail and collapses it. Tab cycles the stops like ↓,
// and Shift+Tab like ↑, both wrapping off the ends, so the rail is left with
// Escape.
//
// Reordering has no mode. A saved collection or showcase row is always
// draggable while the rail is expanded or pinned: its grip appears on row
// hover or focus, its 24px Move up/down buttons sit beside it, and Shift+↑/↓
// jumps the focused row to the top or bottom of its group. A drag outlives
// pointer-leave and blur — only a drop, Escape, or a click outside the rail
// ends it — and the dock holds the open layout for the whole gesture so the
// grip and the drop targets never vanish under the pointer.

// Per-destination icons, lifted from the settled layout-D prototype.
const ICONS = {
  banknote:
    '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  folders:
    '<path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z"/><path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1"/>',
  swap: '<path d="M7.5 4.5v13M7.5 4.5 4.6 7.6M7.5 4.5l2.9 3.1M16.5 19.5v-13M16.5 19.5l2.9-3.1M16.5 19.5l-2.9-3.1"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  // The grip shown on a reorderable row's hover or focus. Three horizontal
  // strokes read as "grab these rows".
  reorder: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  // Section markers for the two sidebar categories. They read as hubs, not
  // as destinations: a stack of books for Catalog, a grid for Showcases. Both
  // are Lucide glyphs, matching the destination icons. Individual showcases
  // use the pile-of-pictures glyph so each row reads as a showcase.
  catalog:
    '<rect width="8" height="18" x="3" y="3" rx="1"/><path d="M7 3v18"/><path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z"/>',
  showcases:
    '<path d="m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16"/><path d="M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2"/><circle cx="13" cy="7" r="1" fill="currentColor"/><rect x="8" y="2" width="14" height="14" rx="2"/>',
  // The pin holds the rail open without hover or focus. One glyph for both
  // states; the pressed state is the accent tint, not a second icon.
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
};

// Shift+↑/↓ jumps a reorderable row to the matching edge of its group.
const SHIFT_ARROW_DIRECTIONS = { ArrowDown: 1, ArrowUp: -1 };

// Every reorder path hands the new id order to the provider, which paints the
// server's order. A rejection therefore leaves the visible rows where they
// were, and one message reports that instead of letting the revert pass as
// "the app ignored me".
const REORDER_FAILURE_MESSAGE =
  "Couldn't save the new order — it was restored.";

// One reorderable row, named by the provider's own id, in the shape both the
// parked focus and the failure hand-back use.
function rowTarget(item) {
  return item.showcaseId != null
    ? { scope: "showcase", id: item.showcaseId }
    : { scope: "collection", id: item.collectionId };
}

// The collapsed rail's second line of identity. A collection or showcase row
// shows its loaded note count, in tabular figures so the marks line up; a row
// with no count (a draft, or a list payload without the field) falls back to
// the name's two-character initials so no row is anonymous.
function initialsOf(name) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // A blank name still gets a mark; it never renders an empty link.
  if (words.length === 0) {
    return "?";
  }

  const first = Array.from(words[0]);

  if (words.length === 1) {
    return first.slice(0, 2).join("").toUpperCase();
  }

  const last = Array.from(words[words.length - 1]);

  return `${first[0]}${last[0]}`.toUpperCase();
}

function railIdentity(item) {
  if (Number.isFinite(item.count)) {
    return String(item.count);
  }

  return initialsOf(item.label);
}

// Only collection and showcase rows carry the collapsed identity mark; All
// notes, Import / Export and the create actions stay plain icons.
function RailMark({ item }) {
  if (item.collectionId == null && item.showcaseId == null) {
    return null;
  }

  return (
    <span aria-hidden="true" className="sidebar-link-mark">
      {railIdentity(item)}
    </span>
  );
}

const ALL_NOTES_ITEM = {
  icon: "list",
  key: "all-notes",
  label: "All notes",
  to: CATALOG_ROUTES.allNotes,
  // A destination, not a collection mode: only its exact route highlights it.
  matches: (pathname) => pathname === CATALOG_ROUTES.allNotes,
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
  // The pin holds the expanded rail open without hover or focus. It survives
  // reload through localStorage; loading it never focuses the toggle.
  const [pinned, setPinned] = useState(loadSidebarPinned);
  // Drag-and-drop state for reordering the showcase rows. `dropTarget` records
  // whether the pointer sits above or below the hovered row's midpoint.
  const [draggedShowcaseId, setDraggedShowcaseId] = useState(null);
  const [showcaseDropTarget, setShowcaseDropTarget] = useState(null);
  // Drag-and-drop state for reordering the collection rows, mirroring
  // showcases. The sidebar never reorders its own copy; the provider applies
  // the server's order.
  const [draggedCollectionId, setDraggedCollectionId] = useState(null);
  const [collectionDropTarget, setCollectionDropTarget] = useState(null);
  const dragActive = draggedShowcaseId != null || draggedCollectionId != null;
  // One reorder request at a time: a second request built from the same list
  // would overwrite the first with a stale order when both land.
  const reorderInFlightRef = useRef(false);
  const navRef = useRef(null);
  const linksRef = useRef([]);
  // The control that held focus when "b" opened the rail. Escape hands focus
  // back to it so opening the menu never loses the page's place, whether that
  // was a table row, the selection bar, or another control.
  const returnFocusRef = useRef(null);
  // The shell owns the one toast host; the rail only tells it when a reorder
  // failed. A rail rendered on its own (a test) raises no message rather than
  // mounting a second host.
  const toastHost = useToastHost();

  // The collection rows sit inside the Catalog group, above Import / Export.
  // A collection row stays highlighted in both of its modes: view and edit
  // are siblings under the collection. A pending (not-yet-saved) collection
  // renders as a draft row that vanishes on Cancel or on leaving its route.
  const collectionItems = collections.map((collection) => ({
    icon: "banknote",
    key: `collection-${collection.id}`,
    label: collection.name,
    to: CATALOG_ROUTES.collection(collection.id),
    count: collection.note_count,
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
    // No new fetch from the rail: only a count the list payload already
    // carries reaches the collapsed mark.
    count: showcase.note_count,
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
        ALL_NOTES_ITEM,
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

  // Pinning never moves focus: the toggle is only reachable while the rail is
  // open, so the click or Enter that flips it already has focus where the
  // collector put it.
  function togglePinned() {
    const next = !pinned;
    setPinned(next);
    saveSidebarPinned(next);
  }

  // A saved collection or showcase row is the only reorderable unit. Drafts
  // are display-only; destinations and actions are not part of an order.
  function isReorderableItem(item) {
    if (item.pending) {
      return false;
    }

    return item.showcaseId != null || item.collectionId != null;
  }

  // Keyboard cursor stops in DOM order: the pin in the head, then each row
  // link/action. Move buttons stay out of the sequence: Shift+↑/↓ moves the
  // focused row without walking into a second control per row.
  const cursorStops = [{ kind: "pin", key: "pin" }];
  for (const group of groups) {
    for (const item of group.items) {
      cursorStops.push({
        kind: "item",
        item,
        key: item.key ?? item.to,
      });
    }
  }
  const stopIndexByKey = new Map(cursorStops.map((stop, index) => [stop.key, index]));
  // The pin is the first stop, in the head above every group.
  const pinIndex = stopIndexByKey.get("pin");
  linksRef.current.length = cursorStops.length;

  // The Shift+↑/↓ row comes from the keyboard cursor, or from a row that
  // native Tab focused (including its move buttons) when no cursor is open.
  function keyboardReorderStop() {
    if (cursorIndex != null) {
      const stop = cursorStops[cursorIndex];
      return stop?.kind === "item" ? stop : null;
    }

    const active = document.activeElement;

    if (!(active instanceof Element) || !navRef.current?.contains(active)) {
      return null;
    }

    const link = active.closest(".sidebar-row")?.querySelector(".sidebar-link");
    const index = link ? Number(link.getAttribute("data-sidebar-index")) : NaN;
    const stop = Number.isInteger(index) ? cursorStops[index] : null;

    return stop?.kind === "item" ? stop : null;
  }

  // After a keyboard move or jump the provider reconciles the order, which
  // rebuilds the stops. Park the moved row so the next render can land the
  // cursor on that row's link in its new place.
  const pendingMoveFocusRef = useRef(null);

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
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      !navRef.current?.contains(active)
        ? active
        : null;

    navRef.current?.focus({ preventScroll: true });

    if (cursorIndex !== null) {
      return;
    }

    const activeIndex = cursorStops.findIndex(
      (stop) =>
        stop.kind === "item" &&
        stop.item.type !== "action" &&
        isItemActive(stop.item, pathname),
    );
    setCursorIndex(activeIndex === -1 ? 0 : activeIndex);
  }

  // Leaving the rail hands focus back to the control that opened it when
  // there is one still on the page (a table row, the selection bar, a button),
  // so the page keeps its place. Otherwise focus falls to the shell's inert
  // focus anchor at the top of <main>, which keeps Tab inside the page rather
  // than on <body>.
  function leaveCursor({ restoreFocus = false } = {}) {
    setCursorIndex(null);

    const returnFocus = restoreFocus ? returnFocusRef.current : null;
    returnFocusRef.current = null;

    if (returnFocus?.isConnected) {
      returnFocus.focus({ preventScroll: true });

      if (document.activeElement === returnFocus) {
        return;
      }
    }

    if (pageFocusRef?.current) {
      pageFocusRef.current.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function activateItemStop(item) {
    if (item?.type === "action") {
      if (item?.actionKind === "new-collection") {
        handleNewCollection();
      } else {
        handleNewShowcase();
      }
      return;
    }

    if (!item) {
      return;
    }

    if (item.to !== newShowcaseTo) {
      discardPendingShowcase();
    }
    if (item.to !== newCollectionTo) {
      discardPendingCollection();
    }
    navigate(item.to);
  }

  // Move DOM focus with the cursor so Tab/Escape and screen readers track it.
  // `preventScroll` matches every other focus call in the rail: without it
  // each arrow press can scroll the navigating list, visibly shifting every
  // row's text.
  useEffect(() => {
    if (cursorIndex === null) {
      return;
    }

    linksRef.current[cursorIndex]?.focus({ preventScroll: true });
  }, [cursorIndex, cursorStops.length]);

  // The stops rebuild when the order reconciles. Clamp a cursor left past the
  // end so it never points at a stop that no longer exists.
  useEffect(() => {
    if (cursorIndex === null) {
      return;
    }

    if (cursorIndex >= cursorStops.length) {
      setCursorIndex(cursorStops.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorStops.length]);

  // Land focus on a row's link by its own id, in whichever place it now sits.
  // In cursor mode the cursor index moves; in native Tab mode focus is handed
  // directly without claiming the cursor.
  function focusRowAfterMove(scope, rowId) {
    const nextIndex = cursorStops.findIndex(
      (stop) =>
        stop.kind === "item" &&
        (scope === "showcase"
          ? stop.item.showcaseId === rowId
          : stop.item.collectionId === rowId),
    );

    if (nextIndex < 0) {
      return;
    }

    if (cursorIndex === null) {
      linksRef.current[nextIndex]?.focus({ preventScroll: true });
      return;
    }

    if (nextIndex !== cursorIndex) {
      setCursorIndex(nextIndex);
    }
  }

  // One message and one focus hand-back per failed request, whichever surface
  // started it. The provider never applied the order, so the row is still
  // where the collector left it. A request can take a while to fail: if focus
  // has since moved to the page (a table control, say), the rail leaves it
  // there and only reports.
  function reportReorderFailure(scope, rowId) {
    pendingMoveFocusRef.current = null;
    toastHost?.current?.show(REORDER_FAILURE_MESSAGE, "danger");

    const active = document.activeElement;
    const focusIsSettled =
      active instanceof HTMLElement &&
      active !== document.body &&
      !navRef.current?.contains(active);

    if (!focusIsSettled) {
      focusRowAfterMove(scope, rowId);
    }
  }

  // After a move lands, focus follows the moved row's link in its new place.
  // The effect runs when the provider's order reconciles; a failure clears
  // the parked row and reports instead.
  useEffect(() => {
    if (pendingMoveFocusRef.current == null) {
      return;
    }

    const moved = pendingMoveFocusRef.current;
    pendingMoveFocusRef.current = null;
    focusRowAfterMove(moved.scope, moved.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showcases, collections]);

  useEffect(() => {
    function handleKeyDown(event) {
      const jumpDirection = event.shiftKey
        ? (SHIFT_ARROW_DIRECTIONS[event.key] ?? null)
        : null;

      // Shift is part of Shift+Tab and the Shift+↑/↓ row jump, which the rail
      // handles; every other shifted key is left to the browser.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (event.shiftKey && event.key !== "Tab" && jumpDirection == null)
      ) {
        return;
      }

      const target = event.target;
      const inSidebar =
        target instanceof Node && navRef.current?.contains(target);

      // Escape ends a drag even when the pointer started it and focus never
      // entered the rail. When a keyboard cursor is also open, the same press
      // closes it and hands focus back to the opener.
      if (event.key === "Escape" && dragActive) {
        event.preventDefault();
        clearDrag();

        if (!inSidebar || cursorIndex === null) {
          return;
        }
      }

      if (!inSidebar) {
        // "b" opens the rail from anywhere: table rows, the selection actions
        // bar, buttons, links. Text-entry controls keep it for typing, and
        // modal surfaces (dialogs, the Note editor, the Note slideshow) own
        // their keys until dismissed.
        if (
          !ownsPrintableShortcut(document.activeElement) &&
          event.key === "b"
        ) {
          event.preventDefault();
          openCursor();
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        leaveCursor({ restoreFocus: true });
        return;
      }

      // Shift+↑/↓ jumps the focused row to the top or bottom of its group,
      // beside the 24px Move up/down buttons that step one place at a time.
      // Rows that cannot reorder keep the browser's own shifted-key behavior.
      if (jumpDirection != null) {
        const stop = keyboardReorderStop();

        if (!stop || !isReorderableItem(stop.item)) {
          return;
        }

        event.preventDefault();
        void reorderItem(stop.item, jumpDirection, { jump: true });
        return;
      }

      const count = cursorStops.length;
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

        const stop = cursorStops[cursorIndex];

        if (stop?.kind === "pin") {
          togglePinned();
          return;
        }

        activateItemStop(stop?.item);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorIndex, pathname, pinned, showcases, pendingShowcase, collections, pendingCollection, dragActive, cursorStops.length]);

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

  // One request at a time: a second order built from the same list would
  // otherwise overwrite the first in flight. Answers true when the server
  // took the order, false when it refused it, and null when the request was
  // skipped — a skipped request has nothing to report.
  async function requestReorder(ids, reorder) {
    if (reorderInFlightRef.current) {
      return null;
    }

    reorderInFlightRef.current = true;

    try {
      await reorder(ids);
      return true;
    } catch {
      return false;
    } finally {
      reorderInFlightRef.current = false;
    }
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

    const landed = await requestReorder(
      nextShowcases.map((showcase) => showcase.id),
      reorderShowcases,
    );

    if (landed === false) {
      reportReorderFailure("showcase", movedShowcase.id);
    }
  }

  function clearCollectionDrag() {
    setDraggedCollectionId(null);
    setCollectionDropTarget(null);
  }

  function clearDrag() {
    clearShowcaseDrag();
    clearCollectionDrag();
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

    const landed = await requestReorder(
      nextCollections.map((collection) => collection.id),
      reorderCollections,
    );

    if (landed === false) {
      reportReorderFailure("collection", movedCollection.id);
    }
  }

  // One step (or, with `jump`, straight to an edge) for the row's Move buttons
  // and the Shift+↑/↓ accelerator. The rail never reorders its own copy: it
  // hands the provider the new id order and lets the server's order land.
  async function reorderItem(item, direction, { jump = false } = {}) {
    if (reorderInFlightRef.current) {
      return;
    }

    const isShowcase = item.showcaseId != null;
    const list = isShowcase ? showcases : collections;
    const reorder = isShowcase ? reorderShowcases : reorderCollections;
    const id = isShowcase ? item.showcaseId : item.collectionId;
    const index = list.findIndex((entry) => entry.id === id);
    const targetIndex = jump
      ? (direction < 0 ? 0 : list.length - 1)
      : index + direction;

    if (
      index < 0 ||
      targetIndex === index ||
      targetIndex < 0 ||
      targetIndex >= list.length
    ) {
      return;
    }

    const next = [...list];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);

    pendingMoveFocusRef.current = rowTarget(item);

    const landed = await requestReorder(
      next.map((entry) => entry.id),
      reorder,
    );

    // A failed request leaves the order unchanged, so no rebuild will consume
    // the parked focus; report it and drop the parked row before a later
    // update steals focus.
    if (landed !== true) {
      pendingMoveFocusRef.current = null;

      if (landed === false) {
        reportReorderFailure(isShowcase ? "showcase" : "collection", id);
      }
    }
  }

  // A click outside the rail ends a drag that is still in flight (for example
  // after the gesture was cancelled by the browser, or after a pointer left
  // and clicked back on the page). A drop or Escape clear it too; hovering out
  // never does.
  useEffect(() => {
    if (!dragActive) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) {
        return;
      }

      clearDrag();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", handlePointerDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragActive]);

  return (
    <div
      className={[
        "sidebar-dock",
        pinned ? "sidebar-dock--pinned" : "",
        // The open layout is held for the whole drag so pointer-leave cannot
        // hide the grips and drop targets mid-gesture.
        cursorIndex !== null || dragActive ? "sidebar-dock--open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
        <nav
          aria-label="Sections"
          className="sidebar"
          id="app-sidebar"
          onBlur={(event) => {
            // Focus leaving the rail collapses the keyboard cursor.
            // `relatedTarget` is the primary signal, but focus moved by a
            // mouse click can arrive without one — fall back to the newly
            // focused element, which is already current. A drag survives
            // blur: only drop, Escape, or a click-away ends it.
            const next =
              event.relatedTarget instanceof Node
                ? event.relatedTarget
                : document.activeElement;
            const focusLeft =
              !(next instanceof Node) ||
              !event.currentTarget.contains(next);

            if (cursorIndex !== null && focusLeft) {
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
            <button
              aria-label="Pin sidebar"
              aria-pressed={pinned}
              className={`sidebar-pin${
                pinned ? " sidebar-pin--active" : ""
              }${
                cursorIndex === pinIndex ? " sidebar-pin--cursor" : ""
              }`}
              data-sidebar-index={pinIndex}
              onClick={() => {
                if (cursorIndex !== null) {
                  setCursorIndex(pinIndex);
                }
                togglePinned();
              }}
              ref={(node) => {
                linksRef.current[pinIndex] = node;
              }}
              title={pinned ? "Unpin sidebar" : "Pin sidebar"}
              type="button"
            >
              <ItemIcon className="sidebar-pin-ic" icon="pin" />
            </button>
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
                    const index = stopIndexByKey.get(item.key ?? item.to);
                    const active =
                      item.type !== "action" && isItemActive(item, pathname);
                    // A pending draft row is display-only: it cannot be
                    // dragged or become a drop target.
                    const reorderable = isReorderableItem(item);
                    const isShowcase = reorderable && item.showcaseId != null;
                    const isCollection = reorderable && item.collectionId != null;
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
                    // The drop/dragging markers live on the row wrapper; the
                    // link keeps only its active/cursor state.
                    const className = `sidebar-link${
                      active ? " sidebar-link--active" : ""
                    }${cursorIndex === index ? " sidebar-link--cursor" : ""}${
                      item.type === "action" ? " sidebar-link--action" : ""
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

                    if (reorderable) {
                      const list = isShowcase ? showcases : collections;
                      const rowId = isShowcase
                        ? item.showcaseId
                        : item.collectionId;
                      const rowIndex = list.findIndex(
                        (entry) => entry.id === rowId,
                      );
                      const canMoveUp = rowIndex > 0;
                      const canMoveDown =
                        rowIndex >= 0 && rowIndex < list.length - 1;
                      const rowClassName = `sidebar-row${
                        dropPlacement
                          ? ` sidebar-row--drop-${dropPlacement}`
                          : ""
                      }${isDragging ? " sidebar-row--dragging" : ""}`;

                      function handleRowDragLeave(event) {
                        const row = event.currentTarget.parentElement;

                        if (
                          event.relatedTarget &&
                          row?.contains(event.relatedTarget)
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

                      function handleRowDragOver(event) {
                        if (isShowcase) {
                          if (draggedShowcaseId == null) {
                            return;
                          }

                          event.preventDefault();
                          updateShowcaseDropTarget(item.showcaseId, event);
                        } else {
                          if (draggedCollectionId == null) {
                            return;
                          }

                          event.preventDefault();
                          updateCollectionDropTarget(item.collectionId, event);
                        }
                      }

                      function handleRowDragStart(event) {
                        if (isShowcase) {
                          handleShowcaseDragStart(event, item.showcaseId);
                        } else {
                          handleCollectionDragStart(event, item.collectionId);
                        }
                      }

                      function handleRowDrop(event) {
                        event.preventDefault();
                        const bounds =
                          event.currentTarget.getBoundingClientRect();
                        if (isShowcase) {
                          const placement =
                            showcaseDropTarget?.showcaseId === item.showcaseId
                              ? showcaseDropTarget.placement
                              : event.clientY < bounds.top + bounds.height / 2
                                ? "before"
                                : "after";
                          void handleShowcaseDrop(item.showcaseId, placement);
                        } else {
                          const placement =
                            collectionDropTarget?.collectionId ===
                            item.collectionId
                              ? collectionDropTarget.placement
                              : event.clientY < bounds.top + bounds.height / 2
                                ? "before"
                                : "after";
                          void handleCollectionDrop(item.collectionId, placement);
                        }
                      }

                      function handleMove(direction) {
                        void reorderItem(item, direction);
                      }

                      return (
                        <div
                          className={rowClassName}
                          data-sidebar-index={index}
                          draggable
                          key={item.key ?? item.to}
                          onDragEnd={clearDrag}
                          onDragLeave={handleRowDragLeave}
                          onDragOver={handleRowDragOver}
                          onDragStart={handleRowDragStart}
                          onDrop={handleRowDrop}
                          title="Drag to reorder"
                        >
                          <Link
                            aria-current={active ? "page" : undefined}
                            aria-label={item.label}
                            className={className}
                            data-sidebar-index={index}
                            draggable={false}
                            onClick={() => handleLinkClick(item.to)}
                            ref={(node) => {
                              linksRef.current[index] = node;
                            }}
                            title={item.label}
                            to={item.to}
                          >
                            {/* The grip shares the item icon's own 22px slot
                            and appears on row hover or focus, so the row
                            never shifts and every icon keeps one column. */}
                            <ItemIcon
                              className="sidebar-ic sidebar-ic--item"
                              icon={item.icon}
                            />
                            <ItemIcon
                              className="sidebar-ic sidebar-ic--grip"
                              icon="reorder"
                            />
                            <span className="sidebar-link-label">
                              {item.label}
                            </span>
                            <RailMark item={item} />
                          </Link>
                          <span className="sidebar-row-moves">
                            <button
                              aria-label={`Move ${item.label} up`}
                              className="sidebar-move-button"
                              disabled={!canMoveUp}
                              onClick={() => handleMove(-1)}
                              title={`Move ${item.label} up`}
                              type="button"
                            >
                              ↑
                            </button>
                            <button
                              aria-label={`Move ${item.label} down`}
                              className="sidebar-move-button"
                              disabled={!canMoveDown}
                              onClick={() => handleMove(1)}
                              title={`Move ${item.label} down`}
                              type="button"
                            >
                              ↓
                            </button>
                          </span>
                        </div>
                      );
                    }

                    // A plain link stays a plain link: actions, Import /
                    // Export, and pending drafts never shift for reordering.
                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        className={className}
                        data-sidebar-index={index}
                        draggable={false}
                        key={item.key ?? item.to}
                        onClick={() => handleLinkClick(item.to)}
                        ref={(node) => {
                          linksRef.current[index] = node;
                        }}
                        title={item.label}
                        to={item.to}
                      >
                        <ItemIcon icon={item.icon} />
                        <span className="sidebar-link-label">{item.label}</span>
                        <RailMark item={item} />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="sidebar-foot">
            <span className="sidebar-version">v{APP_VERSION}</span>
          </div>
        </nav>
    </div>
  );
}

export { Sidebar };
