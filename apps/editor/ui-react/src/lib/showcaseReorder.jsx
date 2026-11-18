import { useEffect, useRef, useState } from "react";
import { appendPositionFor } from "./showcaseTree.js";

// A grid cell has no single before/after edge, so compare the pointer to the
// cell centre horizontally: the edges reorder, and the middle of a container
// opens it for nesting. The order indicator stays a vertical line in the
// column gap, never above or below a card.
const EDGE_RATIO = 0.24;
const SPRING_DELAY_MS = 450;

function isCenter(event, bounds) {
  if (bounds.width <= 0) {
    return false;
  }

  const ratio = (event.clientX - bounds.left) / bounds.width;

  return ratio > EDGE_RATIO && ratio < 1 - EDGE_RATIO;
}

function placementForEvent(event, bounds) {
  const dx = event.clientX - (bounds.left + bounds.width / 2);

  return dx < 0 ? "before" : "after";
}

// A drop that leaves the order untouched has no visible target: the gap
// between two adjacent cards otherwise offers two indicators (`after` on the
// earlier card, `before` on the later one) that both resolve to the same
// no-op move. For the same reason only one edge per gap is active: `before`
// on every card plus `after` on the last card for the end position. An
// `after` on any other card duplicates the next card's `before` (same
// insertion index), so dragging the 1st note between the 2nd and 3rd would
// otherwise offer two drop lines for one destination.
function isNoopMove(nodes, sourceId, targetId, placement) {
  const from = nodes.findIndex((node) => node.id === sourceId);
  const to = nodes.findIndex((node) => node.id === targetId);

  if (from < 0 || to < 0) {
    return true;
  }

  const insertAt = to + (placement === "after" ? 1 : 0);

  return insertAt === from || insertAt === from + 1;
}

// Index the source would take in a sibling list after it is removed and the
// target edge is resolved. Keeps both the order and the drawer drops on the
// server's final-index contract.
function indexForDrop(children, sourceId, targetId, placement) {
  const withoutSource = children.filter((child) => child.id !== sourceId);
  const at = withoutSource.findIndex((child) => child.id === targetId);

  if (at < 0) {
    return null;
  }

  return at + (placement === "after" ? 1 : 0);
}

// Drag state for one level. HTML5 `draggable`, `dataTransfer`, and the order
// targets mirror the old reorder hook; a container's middle adds a spring that
// opens its children as precise drop rows, and the owner applies the move.
function useShowcaseReorder({
  nodes,
  onDragState,
  onReorder,
  onMove,
}) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [springId, setSpringId] = useState(null);
  const [drawerTarget, setDrawerTarget] = useState(null);
  const springTimer = useRef(null);
  const latestNodes = useRef(nodes);

  latestNodes.current = nodes;

  useEffect(
    () => () => {
      if (springTimer.current) {
        clearTimeout(springTimer.current);
      }
      onDragState?.(null);
    },
    [onDragState],
  );

  // The screen owns the ancestor rail and the outcome line; one small snapshot
  // is enough for both, and idle grids stay silent.
  useEffect(() => {
    onDragState?.({
      sourceId: draggedId,
      target: dropTarget,
      drawerId,
      drawerTarget,
      springId,
    });
  }, [
    draggedId,
    dropTarget,
    drawerId,
    drawerTarget,
    springId,
    onDragState,
  ]);

  // Escape steps out one layer at a time: the open drawer first (the drag goes
  // on), then the drag itself. The browser still ends the native drag, but
  // nothing is left armed in the canvas.
  useEffect(() => {
    if (draggedId == null) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();

      if (drawerId != null) {
        setDrawerId(null);
        setDrawerTarget(null);
        setDropTarget(null);
        return;
      }

      clear();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draggedId, drawerId]);

  function clearSpring() {
    if (springTimer.current) {
      clearTimeout(springTimer.current);
      springTimer.current = null;
    }
    setSpringId(null);
  }

  function clear() {
    clearSpring();
    setDraggedId(null);
    setDropTarget(null);
    setDrawerId(null);
    setDrawerTarget(null);
  }

  // The canvas scrolls inside `.screen-body`, not in the window: the columns
  // are a viewport and the page never grows. Autoscroll therefore has to find
  // the scrollable ancestor under the pointer instead of asking `window`.
  function scrollableAncestor(element) {
    let node = element;

    while (node && node !== document.body) {
      const style = getComputedStyle(node);

      if (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  // A drag near a scroller's edge nudges it so a destination above or below the
  // viewport is reachable without letting go.
  function nudgeScroller(scroller, clientY, top, bottom) {
    const margin = 80;

    if (clientY < top + margin) {
      scroller.scrollBy?.(0, -18);
    } else if (clientY > bottom - margin) {
      scroller.scrollBy?.(0, 18);
    }
  }

  function autoScroll(event) {
    const scroller = scrollableAncestor(event.currentTarget);

    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      nudgeScroller(scroller, event.clientY, bounds.top, bounds.bottom);
      return;
    }

    if (
      typeof window.scrollBy !== "function" ||
      document.documentElement.scrollHeight <= window.innerHeight
    ) {
      return;
    }

    nudgeScroller(window, event.clientY, 0, window.innerHeight);
  }

  function handleDragStart(event, nodeId) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(nodeId));
    setDraggedId(nodeId);
    setDropTarget(null);
    setDrawerId(null);
    setDrawerTarget(null);
    clearSpring();
  }

  function startSpring(nodeId) {
    if (springTimer.current) {
      clearTimeout(springTimer.current);
    }
    // The open drawer stays put while the new spring fills. Swapping it the
    // moment the pointer touches another card unmounts the rows the collector
    // may still be aiming at; the 450 ms timer is the only swap point.
    setDrawerTarget(null);
    setSpringId(nodeId);
    springTimer.current = setTimeout(() => {
      springTimer.current = null;
      setSpringId(null);
      setDrawerId(nodeId);
    }, SPRING_DELAY_MS);
  }

  function handleDragOver(event, nodeId, { container = false } = {}) {
    if (draggedId == null) {
      return;
    }

    autoScroll(event);
    const bounds = event.currentTarget.getBoundingClientRect();
    const middle = container && nodeId !== draggedId && isCenter(event, bounds);

    if (middle) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      if (drawerId !== nodeId && springId !== nodeId) {
        startSpring(nodeId);
      }

      setDrawerTarget(null);
      setDropTarget({ nodeId, placement: "into" });
      return;
    }

    // Moving off the middle cancels a pending spring, but an open drawer stays
    // open: the pointer has to cross the card's edge and the gap above the
    // drawer to reach its rows, and that path is not the middle. The drawer
    // closes when another spring completes, on Escape, or when the drag ends.
    if (springId === nodeId) {
      clearSpring();
    }

    setDrawerTarget(null);

    const placement = placementForEvent(event, bounds);

    // One indicator per gap: `after` is only active on the last card (the
    // end position). Any other `after` duplicates the next card's `before`.
    const targetIndex = latestNodes.current.findIndex(
      (node) => node.id === nodeId,
    );

    if (
      placement === "after" &&
      targetIndex !== latestNodes.current.length - 1
    ) {
      setDropTarget((current) => (current == null ? current : null));
      return;
    }

    if (isNoopMove(latestNodes.current, draggedId, nodeId, placement)) {
      setDropTarget((current) => (current == null ? current : null));
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current?.nodeId === nodeId && current?.placement === placement
        ? current
        : { nodeId, placement },
    );
  }

  function handleDragLeave(event, nodeId) {
    const cell = event.currentTarget;

    // Moving from the card into its drawer (or back) stays inside the cell.
    if (event.relatedTarget && cell.contains(event.relatedTarget)) {
      return;
    }

    if (springId === nodeId) {
      clearSpring();
    }

    // A drawer outlives this leave: the pointer crosses the gap between the
    // card and its rows, and a leave fired there must not unmount the list the
    // collector is aiming at. The bridge pseudo-element keeps that gap inside
    // the drawer, so a real leave only clears this cell's highlight.
    setDrawerTarget(null);
    setDropTarget((current) => (current?.nodeId === nodeId ? null : current));
  }

  function dropOrder(targetId, placement) {
    const current = latestNodes.current;
    const from = current.findIndex((node) => node.id === draggedId);
    const to = current.findIndex((node) => node.id === targetId);

    if (from < 0 || to < 0) {
      return;
    }

    const insertAt = to + (placement === "after" ? 1 : 0);
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(from < insertAt ? insertAt - 1 : insertAt, 0, moved);

    if (next.every((node, index) => node.id === current[index].id)) {
      return;
    }

    onReorder?.(
      next.map((node) => node.id),
    );
  }

  async function handleDrop(event, targetId, { children = [] } = {}) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedId;
    const target = dropTarget;
    const placement =
      target?.nodeId === targetId
        ? target.placement
        : placementForEvent(event, event.currentTarget.getBoundingClientRect());

    clear();

    if (sourceId == null) {
      return;
    }

    if (placement === "into") {
      // A container's middle appends at the end; the drawer rows place
      // precisely, and the card can be opened afterwards to fine-tune.
      onMove?.(sourceId, targetId, appendPositionFor(children, sourceId));
      return;
    }

    if (isNoopMove(latestNodes.current, sourceId, targetId, placement)) {
      return;
    }

    dropOrder(targetId, placement);
  }

  function handleDrawerDragOver(event, childId, { parentId: targetParent, children }) {
    if (draggedId == null) {
      return;
    }

    autoScroll(event);
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const rect = event.currentTarget.getBoundingClientRect();
    const placement =
      event.clientY - rect.top > rect.height / 2 ? "after" : "before";
    const index = indexForDrop(children, draggedId, childId, placement);

    if (index == null) {
      return;
    }

    setDrawerTarget((current) =>
      current?.childId === childId &&
      current?.parentId === targetParent &&
      current?.placement === placement
        ? current
        : { childId, parentId: targetParent, placement },
    );
  }

  function handleDrawerDrop(event, childId, { parentId: targetParent, children }) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();

    const target = drawerTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const placement =
      target?.childId === childId
        ? target.placement
        : event.clientY - rect.top > rect.height / 2
          ? "after"
          : "before";
    const index = indexForDrop(children, draggedId, childId, placement);
    const sourceId = draggedId;

    clear();

    if (index == null) {
      return;
    }

    onMove?.(sourceId, targetParent, index);
  }

  // The drawer's own surface (title, padding, gaps between rows): dropping here
  // appends to the open grouping, the same promise an early release on the card
  // makes. Rows stop propagation, so they keep their precise before/after.
  function handleDrawerSurfaceDragOver(event) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrawerTarget((current) =>
      current?.childId == null &&
      current?.parentId === drawerId &&
      current?.placement === "into"
        ? current
        : { childId: null, parentId: drawerId, placement: "into" },
    );
  }

  function handleDrawerSurfaceDrop(event, { children = [] } = {}) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const sourceId = draggedId;
    const targetParent = drawerId;

    clear();

    if (targetParent != null) {
      onMove?.(sourceId, targetParent, appendPositionFor(children, sourceId));
    }
  }

  function handleDrawerIntoDragOver(event, parentId) {
    if (draggedId == null) {
      return;
    }

    autoScroll(event);
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrawerTarget((current) =>
      current?.childId === parentId &&
      current?.parentId === parentId &&
      current?.placement === "into"
        ? current
        : { childId: parentId, parentId, placement: "into" },
    );
  }

  function handleDrawerIntoDrop(event, parentId, { children = [] } = {}) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const sourceId = draggedId;

    clear();
    // "Into" always appends, both on the card and on a nested grouping's row,
    // so the gesture means one thing at every depth.
    onMove?.(sourceId, parentId, appendPositionFor(children, sourceId));
  }

  return {
    draggedId,
    dropTarget,
    drawerId,
    springId,
    drawerTarget,
    clear,
    handleDragStart,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleDrawerDragOver,
    handleDrawerDrop,
    handleDrawerSurfaceDragOver,
    handleDrawerSurfaceDrop,
    handleDrawerIntoDragOver,
    handleDrawerIntoDrop,
  };
}

export { useShowcaseReorder };
