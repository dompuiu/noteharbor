import { useId } from "react";
import { PositionPicker } from "./PositionPicker.jsx";

// The destination Collection, the position inside it, and the "show it after
// saving/moving" choice. Both surfaces that put a note somewhere else — the
// Note editor and the Table screen's Move dialog — read and write the same
// three decisions, so they share one field group instead of drifting apart.
//
// The component owns no state: the caller decides when the surface opens (and
// therefore when the checkbox's default returns).
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
  const positionNeedsReference =
    positionMode === "before" || positionMode === "after";

  return (
    <>
      <div className="field-block full-span">
        <span>Collection</span>
        <select
          aria-label="Collection"
          className="select-input"
          onChange={(event) => onCollectionChange(Number(event.target.value))}
          value={selectedCollectionId ?? ""}
        >
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
      </div>
      {positionNotes.length > 0 ? (
        <div className="field-block full-span">
          <span>Position in collection</span>
          <select
            aria-label="Position in collection"
            className="select-input"
            onChange={(event) => onPositionModeChange(event.target.value)}
            value={positionMode}
          >
            {showKeepPosition ? (
              <option value="keep">Keep current position</option>
            ) : null}
            <option value="start">Start of collection</option>
            <option value="end">End of collection</option>
            <option value="before">Before a note...</option>
            <option value="after">After a note...</option>
          </select>
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

export { CollectionPositionFields };
