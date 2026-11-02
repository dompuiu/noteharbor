import { AnchoredPopover } from "./AnchoredPopover.jsx";

// The rail's `?` trigger. The empty table no longer spends a row on the
// field/Enter model, so this note carries the sentence (and the OR/AND rule)
// without reserving space. The shared popover shell portals the note into
// <body> like the field and column menus, so the table's scroll containers
// cannot clip it.
export function TableFilterHelp() {
  return (
    <AnchoredPopover
      className="table-filter-menu table-filter-menu--note"
      panelLabel="How filters combine"
      renderTrigger={({ triggerProps }) => (
        <button
          {...triggerProps}
          aria-label="How filters combine"
          className="table-filter-help"
          type="button"
        >
          ?
        </button>
      )}
    >
      {
        "No filters yet — pick a field, type, press ⏎. Same field ORs, different fields AND."
      }
    </AnchoredPopover>
  );
}
