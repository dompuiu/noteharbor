import { useState } from "react";
import { ShowcaseNoteCard } from "./ShowcaseNoteCard.jsx";

// Edit-only controls for one note node. It wraps the shared card and adds
// Remove, so the read-only card stays free of edit affordances (mirrors the
// Category editor).
function ShowcaseNoteEditor({ node, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const note = node.note ?? {};
  const label = [note.denomination, note.issue_date].filter(Boolean).join(" ");

  async function handleRemove() {
    setBusy(true);
    setError("");

    try {
      await onRemove(node);
    } catch (removeError) {
      setError(removeError.message || "Could not remove the note.");
      setBusy(false);
    }
  }

  return (
    <div className="showcase-cell">
      <ShowcaseNoteCard mode="edit" note={note} nodeId={node.id} />

      <div className="showcase-cell-controls">
        <button
          aria-label={`Remove note ${label}`.trim()}
          className="button button-danger-soft"
          data-showcase-action="remove"
          disabled={busy}
          onClick={handleRemove}
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
