import { useState } from "react";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";

// Edit-only controls for one note node. Prototype layout mirrors the Grouping
// editor: a remove icon sits top-right on the same line as the reorder drag
// handle (which lives in the surrounding reorder cell at top:8px left:8px).
// When the note sits directly in a Grouping, the caller also passes
// `onSetCover`, which stays as a bottom action and makes this note the
// Grouping's manual cover (S2 / user story 37).
function ShowcaseNoteEditor({ node, onRemove, onSetCover }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const note = node.note ?? {};
  const label = [note.denomination, note.issue_date].filter(Boolean).join(" ");
  const removeLabel = `Remove note ${label}`.trim();

  async function run(action, fallbackMessage) {
    setBusy(true);
    setError("");

    try {
      await action();
    } catch (actionError) {
      setError(actionError.message || fallbackMessage);
      setBusy(false);
    }
  }

  return (
    <div className="showcase-cell showcase-cell--note showcase-note-edit">
      <button
        aria-label={removeLabel}
        className="showcase-note-remove"
        data-showcase-action="remove"
        disabled={busy}
        onClick={() => run(() => onRemove(node), "Could not remove the note.")}
        title="Remove note"
        type="button"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          height="14"
          viewBox="0 0 24 24"
          width="14"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      </button>

      <ShowcaseNoteCard mode="edit" note={note} nodeId={node.id} />

      {onSetCover ? (
        <div className="showcase-cell-controls">
          <button
            aria-label="Set as cover"
            className="button"
            data-showcase-action="cover"
            disabled={busy}
            onClick={() => run(() => onSetCover(node), "Could not set the cover.")}
            type="button"
          >
            Set as cover
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { ShowcaseNoteEditor };
