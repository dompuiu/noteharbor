// The notes table's card shell: the bordered white card, its focus anchor, the
// one rail at the top, and whatever body the screen puts under it. Every state
// of the Table screen — loaded, loading, failed, empty — is this same card, so
// the collection's name and the card's footprint hold from the first frame.
export function TableCard({
  cardClassName = "",
  children,
  focusAnchorRef,
  onDragOver,
  railActions = null,
  railControls = null,
  railActionStatus = null,
  railIdentity = null,
  railNotice = null,
  shellRef,
  shortcuts = null,
}) {
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
        <div className="table-rail">
          <div className="table-rail-identity">
            {railIdentity ? (
              <div className="table-rail-title">{railIdentity}</div>
            ) : null}
            {railActionStatus ? (
              <div className="table-rail-status">{railActionStatus}</div>
            ) : null}
          </div>
          {railControls}
          {railActions ? (
            <div className="table-rail-actions">{railActions}</div>
          ) : null}
        </div>
        {railNotice ? (
          <div className="table-rail-notice">{railNotice}</div>
        ) : null}
        {children}
      </div>
    </>
  );
}
