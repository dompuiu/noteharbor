import { useState } from "react";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";

// Edit-only controls for one note node. It wraps the shared card and adds
// Remove, so the read-only card stays free of edit affordances (mirrors the
// Category / Grouping editor). When the note sits directly in a Grouping, the
// caller also passes `onSetCover`, which makes this note the Grouping's manual
// cover (S2 / user story 37).
function ShowcaseNoteEditor({ node, onRemove, onSetCover }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const note = node.note ?? {};
  const label = [note.denomination, note.issue_date].filter(Boolean).join(" ");

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
    <div className="showcase-cell showcase-cell--note">
      <ShowcaseNoteCard mode="edit" note={note} nodeId={node.id} />

      <div className="showcase-cell-controls">
        {onSetCover ? (
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
        ) : null}
        <button
          aria-label={`Remove note ${label}`.trim()}
          className="button button-danger-soft"
          data-showcase-action="remove"
          disabled={busy}
          onClick={() => run(() => onRemove(node), "Could not remove the note.")}
          type="button"
        >
          Remove
        </button>
      </div>

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { ShowcaseNoteEditor };
