import { useState } from "react";

// A grid cell has no single before/after edge, so compare the pointer to the
// cell centre on both axes and use whichever axis the pointer is nearer to.
function placementForEvent(event, bounds) {
  const dx = event.clientX - (bounds.left + bounds.width / 2);
  const dy = event.clientY - (bounds.top + bounds.height / 2);

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? "before" : "after";
  }

  return dy < 0 ? "before" : "after";
}

// Drag state for reordering the children of one node. It mirrors the sidebar's
// showcase drag: HTML5 `draggable`, `dataTransfer`, a before/after drop target.
// The owner applies the order (it hands ids to the server, then reorders its
// own tree), so a failed request leaves the visible order untouched.
function useShowcaseReorder({ nodes, onReorder }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  function clear() {
    setDraggedId(null);
    setDropTarget(null);
  }

  function handleDragStart(event, nodeId) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(nodeId));
    setDraggedId(nodeId);
    setDropTarget({ nodeId, placement: "before" });
  }

  function handleDragOver(event, nodeId) {
    if (draggedId == null) {
      return;
    }

    event.preventDefault();
    const placement = placementForEvent(
      event,
      event.currentTarget.getBoundingClientRect(),
    );

    setDropTarget((current) =>
      current?.nodeId === nodeId && current?.placement === placement
        ? current
        : { nodeId, placement },
    );
  }

  function handleDragLeave(event, nodeId) {
    const cell = event.currentTarget;

    if (event.relatedTarget && cell.contains(event.relatedTarget)) {
      return;
    }

    setDropTarget((current) =>
      current?.nodeId === nodeId ? null : current,
    );
  }

  async function handleDrop(event, targetId) {
    event.preventDefault();
    const sourceId = draggedId;
    const placement =
      dropTarget?.nodeId === targetId
        ? dropTarget.placement
        : placementForEvent(event, event.currentTarget.getBoundingClientRect());

    clear();

    if (sourceId == null) {
      return;
    }

    const from = nodes.findIndex((node) => node.id === sourceId);
    const to = nodes.findIndex((node) => node.id === targetId);

    if (from < 0 || to < 0) {
      return;
    }

    const insertAt = to + (placement === "after" ? 1 : 0);

    if (insertAt === from || insertAt === from + 1) {
      return;
    }

    const next = [...nodes];
    const [moved] = next.splice(from, 1);
    next.splice(from < insertAt ? insertAt - 1 : insertAt, 0, moved);

    if (next.every((node, index) => node.id === nodes[index].id)) {
      return;
    }

    await onReorder(next.map((node) => node.id));
  }

  return {
    draggedId,
    dropTarget,
    clear,
    handleDragStart,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}

export { useShowcaseReorder };
