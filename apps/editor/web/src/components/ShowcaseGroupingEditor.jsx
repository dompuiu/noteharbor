import { useState } from "react";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";

// Edit-only controls for one Grouping. It wraps the shared card and adds
// Rename / Remove, so the read-only presentation stays free of edit
// affordances. A Grouping is local to its parent, so a rename here never
// touches another Showcase or Placement.
function ShowcaseGroupingEditor({ node, onRemove, onRename, onOpen }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function startEditing() {
    setName(node.name);
    setError("");
    setEditing(true);
  }

  function cancelEditing() {
    setName(node.name);
    setError("");
    setEditing(false);
  }

  async function handleRename(event) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed || trimmed === node.name) {
      cancelEditing();
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onRename(node, trimmed);
      setEditing(false);
    } catch (renameError) {
      setError(renameError.message || "Could not rename the grouping.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError("");

    try {
      await onRemove(node);
    } catch (removeError) {
      setError(removeError.message || "Could not remove the grouping.");
      setBusy(false);
    }
  }

  return (
    <div className="showcase-cell">
      <ShowcaseGroupingCard node={node} onOpen={onOpen} />

      {editing ? (
        <form className="showcase-cell-edit" onSubmit={handleRename}>
          <input
            aria-label={`New name for ${node.name}`}
            autoFocus
            className="showcase-category-input"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
          <div className="showcase-cell-edit-actions">
            <button className="button button-primary" disabled={busy} type="submit">
              Save
            </button>
            <button className="button" onClick={cancelEditing} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="showcase-cell-controls">
          <button
            aria-label={`Rename ${node.name}`}
            className="button"
            onClick={startEditing}
            type="button"
          >
            Rename
          </button>
          <button
            aria-label={`Remove ${node.name}`}
            className="button button-danger-soft"
            disabled={busy}
            onClick={handleRemove}
            type="button"
          >
            Remove
          </button>
        </div>
      )}

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { ShowcaseGroupingEditor };
