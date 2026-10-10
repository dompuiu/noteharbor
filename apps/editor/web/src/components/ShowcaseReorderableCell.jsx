// Edit-mode wrapper that makes one grid cell draggable and a drop target. It
// sits around the shared card/editor so the card components stay presentation
// only and the drag state lives in one place (the `useShowcaseReorder` hook).
// A grip handle is the drag source; the whole cell is the drop target.
function ShowcaseReorderableCell({ nodeId, label, reorder, children }) {
  const {
    draggedId,
    dropTarget,
    clear,
    handleDragStart,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = reorder;
  const placement = dropTarget?.nodeId === nodeId ? dropTarget.placement : null;
  const axis =
    dropTarget?.nodeId === nodeId ? (dropTarget.axis ?? "x") : null;
  const className = `showcase-reorder-cell${
    draggedId === nodeId ? " showcase-reorder-cell--dragging" : ""
  }${placement ? ` showcase-reorder-cell--drop-${placement}-${axis}` : ""}`;

  return (
    <div
      className={className}
      onDragLeave={(event) => handleDragLeave(event, nodeId)}
      onDragOver={(event) => handleDragOver(event, nodeId)}
      onDrop={(event) => handleDrop(event, nodeId)}
    >
      <button
        aria-label={`Reorder ${label}`}
        className="showcase-reorder-handle"
        draggable
        onDragEnd={clear}
        onDragStart={(event) => handleDragStart(event, nodeId)}
        type="button"
      >
        <span aria-hidden="true" className="showcase-reorder-grip">
          ⠿
        </span>
      </button>
      {children}
    </div>
  );
}

export { ShowcaseReorderableCell };
