import { useState } from "react";
import { ShowcaseGroupingCard } from "./ShowcaseGroupingCard.jsx";

// Edit-only controls for one Grouping. Prototype layout: the card keeps its
// open behaviour, a pencil icon sits near the title (over the card footer's
// right edge), and a remove icon sits top-right on the same line as the
// reorder drag handle (which lives in the surrounding reorder cell at
// top:8px left:8px). Both keep the shared `Rename <name>` / `Remove <name>`
// labels and `data-showcase-action` hooks so keyboard shortcuts keep working.
// A Grouping is local to its parent, so a rename here never touches another
// Showcase or Placement.
function ShowcaseGroupingEditor({ node, onRemove, onRename, onOpen, children }) {
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
    <div className="showcase-cell showcase-cell--grouping showcase-grouping-edit">
      <button
        aria-label={`Remove ${node.name}`}
        className="showcase-grouping-remove"
        data-showcase-action="remove"
        disabled={busy}
        onClick={handleRemove}
        title="Remove grouping"
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

      <div className="showcase-grouping-cardwrap">
        <ShowcaseGroupingCard node={node} onOpen={onOpen} />
        {!editing ? (
          <button
            aria-label={`Rename ${node.name}`}
            className="showcase-grouping-rename"
            data-showcase-action="rename"
            onClick={startEditing}
            title="Rename grouping"
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
                d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"
                fill="none"
                stroke="currentColor"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M13.5 6.5l3 3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        ) : null}
      </div>

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
            <button className="button" onClick={cancelEditing} type="button">
              Cancel
            </button>
            <button className="button button-primary" disabled={busy} type="submit">
              Save
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}

      {children}
    </div>
  );
}

export { ShowcaseGroupingEditor };
