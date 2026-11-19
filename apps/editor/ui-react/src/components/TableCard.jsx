// The notes table's card shell: the bordered white card, its focus anchor, the
// rail at the top when a loaded view has controls to put in it, and whatever
// body the screen puts under it. Every state of the Table screen — loaded,
// loading, failed, empty — is this same card, so the footprint holds from the
// first frame while the collection's name stays above it.
export function TableCard({
  cardClassName = "",
  children,
  focusAnchorRef,
  onDragOver,
  chipsOwnLine = false,
  railActions = null,
  railActionsRef,
  railControls = null,
  shellRef,
  shortcuts = null,
}) {
  const hasRail = Boolean(railControls || railActions);

  return (
    <>
      {shortcuts}
      <div
        className={`table-shell${cardClassName ? ` ${cardClassName}` : ""}`}
        onDragOver={onDragOver}
        ref={shellRef}
      >
        <span
          aria-hidden="true"
          className="table-focus-anchor"
          ref={focusAnchorRef}
          tabIndex={-1}
        />
        {hasRail ? (
          <div
            className={`table-rail${chipsOwnLine ? " table-rail--chips-own-line" : ""}`}
          >
            {railControls}
            {railActions ? (
              <div className="table-rail-actions" ref={railActionsRef}>
                {railActions}
              </div>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
    </>
  );
}
