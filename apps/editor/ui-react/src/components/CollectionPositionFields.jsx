import { useId } from "react";
import { PositionPicker } from "./PositionPicker.jsx";
import { SelectField } from "./SelectField.jsx";

// The destination Collection, the position inside it, and the "show it after
// saving/moving" choice. Both surfaces that put a note somewhere else — the
// Note editor and the Table screen's Move dialog — read and write the same
// three decisions, so they share one field group instead of drifting apart.
//
// The component owns no state: the caller decides when the surface opens (and
// therefore when the checkbox's default returns).
function needsPositionReference(mode) {
  return mode === "before" || mode === "after";
}

function CollectionPositionFields({
  collections,
  currentCollectionId,
  emptyPositionMessage = null,
  onCollectionChange,
  onPositionModeChange,
  onPositionReferenceChange,
  onShowCollectionAfterChange,
  positionMode,
  positionNotes,
  positionReferenceId,
  selectedCollectionId,
  showAfterAction,
  showCollectionAfter,
  showKeepPosition = false,
}) {
  const checkboxId = useId();
  const targetCollection =
    collections.find((collection) => collection.id === selectedCollectionId) ??
    null;
  const choosingDifferentCollection =
    selectedCollectionId !== currentCollectionId;
  const positionNeedsReference = needsPositionReference(positionMode);

  return (
    <>
      <div className="field-block full-span">
        <span>Collection</span>
        <SelectField
          ariaLabel="Collection"
          onChange={onCollectionChange}
          options={collections.map((collection) => ({
            label: collection.name,
            value: collection.id,
          }))}
          value={selectedCollectionId}
        />
      </div>
      {positionNotes.length > 0 ? (
        <div className="field-block full-span">
          <span>Position in collection</span>
          <SelectField
            ariaLabel="Position in collection"
            onChange={onPositionModeChange}
            options={[
              ...(showKeepPosition
                ? [{ label: "Keep current position", value: "keep" }]
                : []),
              { label: "Start of collection", value: "start" },
              { label: "End of collection", value: "end" },
              { label: "Before a note...", value: "before" },
              { label: "After a note...", value: "after" },
            ]}
            value={positionMode}
          />
          {positionNeedsReference && positionReferenceId === null ? (
            <p className="error-text">
              Select a reference note from the list below.
            </p>
          ) : null}
          {positionNeedsReference ? (
            <PositionPicker
              key={positionMode}
              notes={positionNotes}
              onSelect={(id) => onPositionReferenceChange(id)}
              selectedId={positionReferenceId}
            />
          ) : null}
        </div>
      ) : emptyPositionMessage ? (
        <p className="muted field-block full-span">{emptyPositionMessage}</p>
      ) : null}
      <label className="field-checkbox full-span" htmlFor={checkboxId}>
        <input
          checked={showCollectionAfter}
          disabled={!choosingDifferentCollection}
          id={checkboxId}
          onChange={(event) =>
            onShowCollectionAfterChange(event.target.checked)}
          type="checkbox"
        />
        <span>
          Show {targetCollection?.name ?? "the collection"} after{" "}
          {showAfterAction}
        </span>
      </label>
    </>
  );
}

export { CollectionPositionFields, needsPositionReference };
