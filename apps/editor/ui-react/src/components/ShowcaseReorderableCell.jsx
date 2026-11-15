// One grid cell in the always-editable showcase canvas. The whole item is the
// drag source (the grip is only an affordance), and the cell is also the drop
// target. The top bar is the item's window chrome: the grip on the left, the
// actions menu on the right, and — when the card has no footer of its own —
// the item's caption as the title in between. A `menu` node renders in the
// corner, so reorder and per-item actions live on the same item without a
// separate edit mode.
//
// Catalog cards bring their own rail, so `embedded` suppresses the generic bar
// and hands the grip to the card. The menu stays here: it is a sibling of the
// card button (a button cannot contain another button) and keeps its
// top-right anchor inside whichever rail the card draws.
function ShowcaseReorderableCell({
  nodeId,
  label,
  title = null,
  reorder,
  menu = null,
  children,
  embedded = false,
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
  }${placement ? ` showcase-reorder-cell--drop-${placement}` : ""}${
    embedded ? " showcase-reorder-cell--embedded" : ""
  }`;
  const grip = enabled ? (
    <span
      aria-hidden="true"
      className="showcase-reorder-handle"
      title={`Drag ${label} to reorder`}
    >
      <svg
        aria-hidden="true"
        className="showcase-reorder-grip"
        focusable="false"
        height="12"
        viewBox="0 0 12 12"
        width="12"
      >
        <g fill="currentColor">
          <circle cx="3.5" cy="2.5" r="1.1" />
          <circle cx="8.5" cy="2.5" r="1.1" />
          <circle cx="3.5" cy="6" r="1.1" />
          <circle cx="8.5" cy="6" r="1.1" />
          <circle cx="3.5" cy="9.5" r="1.1" />
          <circle cx="8.5" cy="9.5" r="1.1" />
        </g>
      </svg>
    </span>
  ) : null;

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
      {embedded ? (
        <>
          {typeof children === "function" ? children({ grip }) : children}
          {menu}
        </>
      ) : (
        <>
          <div className="showcase-reorder-bar">
            {grip}
            {title ? (
              <span
                aria-hidden="true"
                className="showcase-reorder-title"
                title={title}
              >
                {title}
              </span>
            ) : null}
            {menu}
          </div>
          {children}
        </>
      )}
    </div>
  );
}

export { ShowcaseReorderableCell };
