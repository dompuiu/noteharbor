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

  // Escape cancels the pending spring and every drop target. The browser still
  // ends the native drag, but nothing is left armed in the canvas.
  useEffect(() => {
    if (draggedId == null) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      clear();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draggedId]);

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

  function autoScroll(event) {
    if (
      typeof window.scrollBy !== "function" ||
      document.documentElement.scrollHeight <= window.innerHeight
    ) {
      return;
    }

    const margin = 80;

    if (event.clientY < margin) {
      window.scrollBy(0, -18);
    } else if (event.clientY > window.innerHeight - margin) {
      window.scrollBy(0, 18);
    }
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
    setDrawerId(null);
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

    clearSpring();
    setDrawerId(null);
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

    if (drawerId === nodeId) {
      setDrawerId(null);
      setDrawerTarget(null);
    }

    setDropTarget((current) =>
      current?.nodeId === nodeId ? null : current,
    );
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

  function handleDrawerEmptyDragOver(event) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrawerTarget({ childId: null, parentId: drawerId, placement: "into" });
  }

  function handleDrawerEmptyDrop(event) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const sourceId = draggedId;
    const targetParent = drawerId;

    clear();

    if (targetParent != null) {
      onMove?.(sourceId, targetParent, 0);
    }
  }

  function handleDrawerIntoDragOver(event, childId) {
    if (draggedId == null) {
      return;
    }

    autoScroll(event);
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrawerTarget({
      childId,
      parentId: childId,
      placement: "into",
    });
  }

  function handleDrawerIntoDrop(event, childId) {
    if (draggedId == null) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const sourceId = draggedId;

    clear();
    onMove?.(sourceId, childId, 0);
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
    handleDrawerEmptyDragOver,
    handleDrawerEmptyDrop,
    handleDrawerIntoDragOver,
    handleDrawerIntoDrop,
  };
}

export { useShowcaseReorder };
