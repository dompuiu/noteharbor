import { useEffect, useId, useMemo, useRef } from "react";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";
import { catalogEntryIdentity, hasSeenPrimary } from "../lib/showcaseTree.js";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";

// The specimen manager behind a catalog card's multi-note strip and the
// ownership menu's "Notes on this entry". It lists the entry's specimens in
// their server order: an ownership chip, a real radio group for the primary,
// and a remove action per row. Below the list sits the note finder in append
// mode, hiding notes already attached.
//
// Every write is the full ordered specimen set (`PUT /api/nodes/:id/notes`);
// the screen replaces the entry from the response, so a removal that promotes
// a new primary or an entry that drops to Seen arrives from the server rather
// than being guessed here. The manager stays open through a write so the list
// and the finder update in place.
function specimenLabel(note) {
  return showcaseNoteDisplayParts(note).join(" · ") || "Untitled note";
}

function ShowcaseSpecimenManager({
  collections = [],
  entry,
  error = "",
  onAdd,
  onClose,
  onPromote,
  onRemove,
}) {
  const titleId = useId();
  const radioName = useId();
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const lastSpecimenCountRef = useRef(null);
  const specimens = entry?.specimens ?? [];
  const primaryId = entry?.primary_note_id;
  const identity = catalogEntryIdentity(entry?.entry);
  // An entry's ownership is the specimens'; the primary only decides what the
  // card and the slideshow show. An owned entry may present a seen reference,
  // and the copy says so instead of implying the entry is unowned.
  const referencePrimary = hasSeenPrimary(entry);

  // Open on the current primary: the row is the dialog's purpose and the first
  // thing a keyboard reader wants. The footer's Done stays one Tab away.
  useEffect(() => {
    const dialog = dialogRef.current;
    const target =
      dialog?.querySelector('input[type="radio"]:checked') ??
      dialog?.querySelector('input[type="radio"]') ??
      closeRef.current;

    target?.focus();
  }, []);

  // A write that appends a specimen replaces the disabled "Add selected"
  // button with a new row. Move focus to that row's radio so the reader lands
  // on the thing they just added instead of <body>.
  useEffect(() => {
    const previous = lastSpecimenCountRef.current;
    lastSpecimenCountRef.current = specimens.length;

    if (previous == null || specimens.length <= previous) {
      return;
    }

    const newest = specimens[specimens.length - 1];
    const radio = dialogRef.current?.querySelector(
      `input[type="radio"][value="${newest?.id}"]`,
    );

    radio?.focus();
  }, [specimens]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      // The manager is modal, so Tab stays inside it and wraps at both ends.
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      const focusables = Array.from(
        dialog.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (!focusables.length) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // The picker filters on this list, so keep its identity stable across
  // renders; the entry's specimen array only changes on a write.
  const excludedNoteIds = useMemo(
    () =>
      specimens
        .map((specimen) => specimen?.id)
        .filter((id) => Number.isInteger(id)),
    [specimens],
  );

  return (
    <div
      className="showcase-manager-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="showcase-manager"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <div className="showcase-manager-head">
          <h2 className="showcase-manager-title" id={titleId}>
            Notes on {identity}
          </h2>
          <p className="showcase-manager-subtitle">
            {specimens.length
              ? `${specimens.length} ${specimens.length === 1 ? "specimen" : "specimens"} in entry order. The primary is what the card and slideshow show.`
              : "No specimens yet. Add the first note below; it becomes the primary."}
          </p>
        </div>

        <div className="showcase-manager-scroll">
          {error ? (
            <p className="showcase-error" role="alert">
              {error}
            </p>
          ) : null}

          {specimens.length ? (
            <div
              aria-label="Primary specimen"
              className="showcase-manager-list"
              role="radiogroup"
            >
              {specimens.map((specimen) => {
                const label = specimenLabel(specimen);
                const owned = Boolean(specimen?.owned);

                return (
                  <div className="showcase-manager-row" key={specimen.id}>
                    <label className="showcase-manager-choice">
                      <input
                        aria-label={`${label}, ${owned ? "owned" : "seen"}`}
                        checked={specimen.id === primaryId}
                        name={radioName}
                        onChange={() => onPromote?.(specimen.id)}
                        type="radio"
                        value={specimen.id}
                      />
                      <span className="showcase-manager-note">{label}</span>
                    </label>
                    <span
                      className={`showcase-manager-chip${
                        owned ? " showcase-manager-chip--owned" : ""
                      }`}
                    >
                      {owned ? "Owned" : "Seen"}
                    </span>
                    <button
                      aria-label={`Remove ${label} from this entry`}
                      className="button showcase-manager-remove"
                      onClick={() => onRemove?.(specimen.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {referencePrimary ? (
            <p className="showcase-manager-warning" role="status">
              This entry is owned, but its primary is a seen reference. The
              entry stays owned and the slideshow shows that photo.
            </p>
          ) : null}

          <div className="showcase-manager-add">
            <ShowcaseNotePicker
              collections={collections}
              embedded
              excludeNoteIds={excludedNoteIds}
              node={entry}
              onAdd={onAdd}
              onClose={onClose}
            />
          </div>
        </div>

        <div className="showcase-manager-foot">
          <span className="muted showcase-manager-foot-note">
            Changes save as you go.
          </span>
          <button
            className="button"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export { ShowcaseSpecimenManager };
