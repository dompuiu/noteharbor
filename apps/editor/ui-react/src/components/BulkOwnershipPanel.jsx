import { useId, useRef, useState } from "react";
import { BulkPanel } from "./BulkPanel.jsx";

// The bulk Ownership panel. It stages one state for the whole selection, so the
// bar carries a single action instead of a pair of buttons that both write the
// moment they are clicked. The Table screen owns the write and its refetch;
// this panel only holds the staged choice.
export function BulkOwnershipPanel({
  anchorRef,
  error = "",
  notes = [],
  onApply,
  onClose,
  saving = false,
}) {
  const firstOptionRef = useRef(null);
  const groupId = useId();
  const [staged, setStaged] = useState(null);

  const selectedCount = notes.length;
  const ownedCount = notes.filter((note) => note.owned).length;
  const unownedCount = selectedCount - ownedCount;
  const selectedNoun = `${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`;
  const canApply = !saving && staged != null;
  const options = [
    { count: ownedCount, key: "owned", label: "Owned", value: true },
    { count: unownedCount, key: "unowned", label: "Unowned", value: false },
  ];

  return (
    <BulkPanel
      anchorRef={anchorRef}
      announcer={
        staged == null
          ? ""
          : `Selected notes will be marked ${staged ? "owned" : "unowned"}.`
      }
      error={error}
      focusRef={firstOptionRef}
      id="bulk-ownership-panel"
      onClose={onClose}
      onPrimary={() => onApply(staged)}
      primaryDisabled={!canApply}
      primaryLabel={`Apply to ${selectedCount} note${selectedCount === 1 ? "" : "s"}`}
      saving={saving}
      scope={`${selectedNoun} · set one state for all`}
      title="Ownership"
      width={360}
    >
      <span className="bulk-panel-label" id={`${groupId}-label`}>
        Mark the selection as
      </span>
      <div
        aria-labelledby={`${groupId}-label`}
        className="bulk-ownership-options"
        role="radiogroup"
      >
        {options.map((option, index) => {
          const hintId = `${groupId}-${option.key}-hint`;

          return (
            <label className="bulk-ownership-option" key={option.key}>
              <input
                aria-describedby={hintId}
                aria-label={option.label}
                checked={staged === option.value}
                disabled={saving}
                name={groupId}
                onChange={() => setStaged(option.value)}
                ref={index === 0 ? firstOptionRef : undefined}
                type="radio"
              />
              <span className="bulk-ownership-option-copy">
                <span className="bulk-ownership-option-label">
                  {option.label}
                </span>
                <span className="bulk-ownership-option-hint" id={hintId}>
                  {option.count} of {selectedCount} currently{" "}
                  {option.value ? "owned" : "unowned"}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </BulkPanel>
  );
}
