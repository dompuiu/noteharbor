import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as api from "../lib/api.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import { CollectionPositionFields } from "./CollectionPositionFields.jsx";

// The Table screen's one way of moving notes to another collection: the bulk
// bar and a row's actions menu both open it. It always calls the scoped bulk
// endpoint (one note travels as a list of one), so the row menu and the bulk
// bar move notes through the same all-or-nothing path.
function firstOtherCollection(collections, currentCollectionId) {
  return (
    collections.find((collection) => collection.id !== currentCollectionId) ??
    collections[0] ??
    null
  );
}

function MoveNotesDialog({
  collections,
  currentCollectionId,
  noteIds,
  onClose,
  onStayed,
}) {
  const navigate = useNavigate();
  const titleId = useId();
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const targetRequestRef = useRef(0);
  const initialTarget = firstOtherCollection(collections, currentCollectionId);
  const [destinationCollectionId, setDestinationCollectionId] = useState(
    initialTarget?.id ?? null,
  );
  const [positionMode, setPositionMode] = useState("end");
  const [positionReferenceId, setPositionReferenceId] = useState(null);
  const [showCollectionAfter, setShowCollectionAfter] = useState(true);
  const [targetNotes, setTargetNotes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const targetCollection =
    collections.find(
      (collection) => collection.id === destinationCollectionId,
    ) ?? null;
  const sameCollection = destinationCollectionId === currentCollectionId;
  const title =
    noteIds.length === 1 ? "Move note" : `Move ${noteIds.length} notes`;

  // The position picker names notes in the destination, so a collection change
  // loads that collection's list. The source collection needs none: choosing
  // it is the no-op the dialog closes on.
  useEffect(() => {
    const requestId = ++targetRequestRef.current;
    setPositionReferenceId(null);
    setError("");

    if (destinationCollectionId == null || sameCollection) {
      setTargetNotes([]);
      return;
    }

    setTargetNotes([]);
    api.getNotes(destinationCollectionId)
      .then((payload) => {
        if (requestId !== targetRequestRef.current) {
          return;
        }

        const movingIds = new Set(noteIds);
        setTargetNotes(
          (payload.notes ?? []).filter((note) => !movingIds.has(note.id)),
        );
      })
      .catch((fetchError) => {
        if (requestId !== targetRequestRef.current) {
          return;
        }

        setError(fetchError.message);
      });

    return () => {
      targetRequestRef.current += 1;
    };
  }, [destinationCollectionId, noteIds, sameCollection]);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      // The dialog is modal: Tab wraps inside it rather than reaching the
      // table behind the overlay.
      const items = Array.from(
        dialogRef.current?.querySelectorAll(
          'button:not([disabled]), select:not([disabled]), input:not([disabled])',
        ) ?? [],
      );

      if (!items.length) {
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, saving]);

  function handleCollectionChange(collectionId) {
    setDestinationCollectionId(collectionId);
    setPositionMode("end");
  }

  async function handleMove() {
    if (saving) {
      return;
    }

    setError("");

    // Moving to the collection the notes already live in is a no-op: no
    // request, no toast and no navigation, only the selection clears.
    if (sameCollection || destinationCollectionId == null) {
      onStayed(null, []);
      onClose();
      return;
    }

    setSaving(true);

    try {
      await api.moveNotes(
        noteIds,
        currentCollectionId,
        destinationCollectionId,
        { mode: positionMode, referenceId: positionReferenceId },
      );

      const collectionName = targetCollection?.name ?? "the collection";
      const message =
        noteIds.length === 1
          ? `Moved to ${collectionName}.`
          : `Moved ${noteIds.length} notes to ${collectionName}.`;

      onClose();

      if (showCollectionAfter) {
        // The destination table shows the moved note and the toast; it opens
        // fresh because the collection switch owns the filter and view reset.
        navigate(CATALOG_ROUTES.collection(destinationCollectionId), {
          state: { highlightNoteId: noteIds[0], toast: message },
        });
        return;
      }

      onStayed(message, noteIds);
    } catch (moveError) {
      setError(moveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="confirm-dialog-overlay" role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="confirm-dialog move-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <h2 className="confirm-dialog-title" id={titleId}>
          {title}
        </h2>
        <form
          className="move-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleMove();
          }}
        >
          <CollectionPositionFields
            collections={collections}
            currentCollectionId={currentCollectionId}
            emptyPositionMessage="This note will be the only one in the destination collection."
            onCollectionChange={handleCollectionChange}
            onPositionModeChange={(mode) => {
              setPositionMode(mode);
              setPositionReferenceId(null);
            }}
            onPositionReferenceChange={setPositionReferenceId}
            onShowCollectionAfterChange={setShowCollectionAfter}
            positionMode={positionMode}
            positionNotes={targetNotes}
            positionReferenceId={positionReferenceId}
            selectedCollectionId={destinationCollectionId}
            showAfterAction="moving"
            showCollectionAfter={showCollectionAfter}
          />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="confirm-dialog-actions">
            <button
              className="button"
              disabled={saving}
              onClick={onClose}
              ref={cancelRef}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={saving}
              type="submit"
            >
              {saving ? "Moving..." : "Move"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { MoveNotesDialog };
