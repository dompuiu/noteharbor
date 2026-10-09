import { useState } from "react";

// Shared edit-shell for a Category Placement and a Grouping. It renders the
// shared card and adds Rename / Remove, so the read-only presentation stays free
// of edit affordances. `noun` only selects the error wording; a Category rename
// renames the shared label server-side while a Grouping rename stays local, but
// that difference lives in the `onRename` the caller passes.
function ShowcaseNodeEditor({ card, node, noun, onRemove, onRename, children }) {
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
      setError(renameError.message || `Could not rename the ${noun}.`);
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
      setError(removeError.message || `Could not remove the ${noun}.`);
      setBusy(false);
    }
  }

  return (
    <div className="showcase-cell">
      {card}

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
            data-showcase-action="rename"
            onClick={startEditing}
            type="button"
          >
            Rename
          </button>
          <button
            aria-label={`Remove ${node.name}`}
            className="button button-danger-soft"
            data-showcase-action="remove"
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

      {children}
    </div>
  );
}

export { ShowcaseNodeEditor };
