import { useState } from "react";

// Shared edit-shell for a Category Placement (and any card-styled node that
// renders through it). Prototype layout, mirroring the Grouping editor: the
// title sits beside an inline pencil right where it ends, move arrows and a
// remove icon sit on the right of the header row, and renaming swaps the
// title for a text field with save / discard icons in place. All icons keep
// the shared `Rename <name>` / `Remove <name>` labels and
// `data-showcase-action` hooks so keyboard shortcuts keep working. `noun`
// only selects the error wording; a Category rename renames the shared label
// server-side while a Grouping rename stays local, but that difference lives
// in the `onRename` the caller passes.
function ShowcaseNodeEditor({
  card,
  node,
  noun,
  onRemove,
  onRename,
  children,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
}) {
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
    <div className={`showcase-cell showcase-cell--${noun}`}>
      <div className="showcase-node-headrow">
        {editing ? (
          <form className="showcase-node-rename-form" onSubmit={handleRename}>
            <input
              aria-label={`New name for ${node.name}`}
              autoFocus
              className="showcase-node-input"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelEditing();
                }
              }}
              value={name}
            />
            <button
              aria-label="Save"
              className="showcase-node-save"
              disabled={busy}
              title="Save name"
              type="submit"
            >
              <svg
                aria-hidden="true"
                focusable="false"
                height="13"
                viewBox="0 0 24 24"
                width="13"
              >
                <path
                  d="M4 12.5l5 5L20 6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2.5"
                />
              </svg>
            </button>
            <button
              aria-label="Cancel"
              className="showcase-node-cancel"
              onClick={cancelEditing}
              title="Discard changes"
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
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          </form>
        ) : (
          <>
            <div className="showcase-node-title">
              {card}
              <button
                aria-label={`Rename ${node.name}`}
                className="showcase-node-rename"
                data-showcase-action="rename"
                onClick={startEditing}
                title={`Rename ${noun}`}
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
            </div>
            <div className="showcase-node-actions">
              {onMoveUp ? (
                <button
                  aria-label={`Move ${node.name} up`}
                  className="showcase-node-move"
                  data-showcase-action="move-up"
                  disabled={!canMoveUp}
                  onClick={() => onMoveUp(node)}
                  title="Move up"
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
                      d="M12 19V5M5 12l7-7 7 7"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              ) : null}
              {onMoveDown ? (
                <button
                  aria-label={`Move ${node.name} down`}
                  className="showcase-node-move"
                  data-showcase-action="move-down"
                  disabled={!canMoveDown}
                  onClick={() => onMoveDown(node)}
                  title="Move down"
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
                      d="M12 5v14M5 12l7 7 7-7"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                </button>
              ) : null}
              <button
                aria-label={`Remove ${node.name}`}
                className="showcase-node-remove"
                data-showcase-action="remove"
                disabled={busy}
                onClick={handleRemove}
                title={`Remove ${noun}`}
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
            </div>
          </>
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

export { ShowcaseNodeEditor };
