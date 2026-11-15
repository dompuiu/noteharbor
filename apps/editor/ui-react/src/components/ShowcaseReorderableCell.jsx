// One grid cell in the always-editable showcase canvas. The whole item is the
// drag source (the grip is only an affordance), and the cell is also the drop
// target. A `menu` node renders in the corner, so reorder and per-item actions
// live on the same item without a separate edit mode.
function ShowcaseReorderableCell({
  nodeId,
  label,
  reorder,
  menu = null,
  children,
}) {
  const enabled = reorder != null;
  const {
    draggedId,
    dropTarget,
    clear,
    handleDragStart,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = reorder ?? {};
  const placement =
    enabled && dropTarget?.nodeId === nodeId ? dropTarget.placement : null;
  const className = `showcase-reorder-cell${enabled ? " showcase-reorder-cell--draggable" : ""}${
    enabled && draggedId === nodeId ? " showcase-reorder-cell--dragging" : ""
  }${placement ? ` showcase-reorder-cell--drop-${placement}` : ""}`;

  return (
    <div
      className={className}
      draggable={enabled}
      onDragEnd={enabled ? clear : undefined}
      onDragLeave={enabled ? (event) => handleDragLeave(event, nodeId) : undefined}
      onDragOver={enabled ? (event) => handleDragOver(event, nodeId) : undefined}
      onDragStart={
        enabled ? (event) => handleDragStart(event, nodeId) : undefined
      }
      onDrop={enabled ? (event) => handleDrop(event, nodeId) : undefined}
    >
      {enabled ? (
        <span
          aria-hidden="true"
          className="showcase-reorder-handle"
          title={`Drag ${label} to reorder`}
        >
          <span aria-hidden="true" className="showcase-reorder-grip">
            ⠿
          </span>
        </span>
      ) : null}
      {menu}
      {children}
    </div>
  );
}

export { ShowcaseReorderableCell };
