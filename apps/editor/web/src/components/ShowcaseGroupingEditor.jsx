import { useState } from "react";
import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { resolveGroupingCover } from "../lib/showcaseCovers.js";

// Edit-only controls for one Grouping. Prototype layout: a remove icon sits
// top-right on the same line as the reorder drag handle (which lives in the
// surrounding reorder cell at top:8px left:8px), and a pencil icon sits inline
// right where the title text ends. The title row is outside the open button
// (a button cannot nest inside the card button), so the cover image is the
// single `Open grouping <name>` control and the title text reuses the same
// `onOpen` on click. Both icons keep the shared `Rename <name>` /
// `Remove <name>` labels and `data-showcase-action` hooks so keyboard
// shortcuts keep working. A Grouping is local to its parent, so a rename here
// never touches another Showcase or Placement.
function ShowcaseGroupingEditor({ node, onRemove, onRename, onOpen, children }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(node.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const coverImage = firstAvailableNoteImage(resolveGroupingCover(node));

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

      <div className="showcase-grouping-editcard">
        <button
          aria-label={`Open grouping ${node.name}`}
          className="showcase-card showcase-grouping-open"
          data-showcase-node-id={node.id}
          onClick={onOpen}
          type="button"
        >
          {coverImage ? (
            <img alt="" className="showcase-card-image" src={coverImage.path} />
          ) : (
            <span
              aria-hidden="true"
              className="showcase-card-cover showcase-card-cover--empty"
            />
          )}
        </button>
        {editing ? (
          <form className="showcase-grouping-rename-form" onSubmit={handleRename}>
            <span className="showcase-card-name showcase-grouping-name">
              <svg
                aria-hidden="true"
                className="showcase-card-name-icon"
                focusable="false"
                height="16"
                viewBox="0 0 24 24"
                width="16"
              >
                <path
                  d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                aria-label={`New name for ${node.name}`}
                autoFocus
                className="showcase-grouping-input"
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEditing();
                  }
                }}
                value={name}
              />
            </span>
            <div className="showcase-cell-edit-actions">
              <button className="button" onClick={cancelEditing} type="button">
                Cancel
              </button>
              <button
                className="button button-primary"
                disabled={busy}
                type="submit"
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <span className="showcase-card-name showcase-grouping-name">
            <svg
              aria-hidden="true"
              className="showcase-card-name-icon"
              focusable="false"
              height="16"
              viewBox="0 0 24 24"
              width="16"
            >
              <path
                d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="showcase-card-name-text showcase-grouping-title"
              onClick={onOpen}
              title={`Open grouping ${node.name}`}
            >
              {node.name}
            </span>
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
                height="13"
                viewBox="0 0 24 24"
                width="13"
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
          </span>
        )}
      </div>

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
