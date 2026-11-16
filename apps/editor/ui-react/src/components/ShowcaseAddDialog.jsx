import { useEffect, useId, useRef, useState } from "react";
import { ShowcaseCatalogShellForm } from "./ShowcaseCatalogShellForm.jsx";
import { ShowcaseNotePicker } from "./ShowcaseNotePicker.jsx";

// One add surface for a showcase level. Notes, catalog shells, and groupings
// used to be separate edit-mode flows; they are one dialog with tabs now
// because all three add a card to the same place. The caller passes the
// insertion point: `afterId` names the item the menu was opened on, or null for
// "at the end".
function GroupingNameForm({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = name.trim();

  async function submit(event) {
    event.preventDefault();

    if (!trimmed || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onAdd(trimmed);
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || "Could not add the grouping.");
      setBusy(false);
    }
  }

  return (
    <form className="showcase-shell-form" onSubmit={submit}>
      <label className="field-block">
        <span>Grouping name</span>
        <input
          aria-label="Grouping name"
          autoFocus
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Kingdom"
          value={name}
        />
      </label>

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="showcase-shell-form-actions">
        <button className="button" onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="button button-primary"
          disabled={!trimmed || busy}
          type="submit"
        >
          Add grouping
        </button>
      </div>
    </form>
  );
}

function ShowcaseAddDialog({
  collections = [],
  parent,
  afterId = null,
  initialMode = "notes",
  onAddNotes,
  onAddShells,
  onAddGrouping,
  onClose,
}) {
  const [mode, setMode] = useState(initialMode);
  const titleId = useId();
  const panelRef = useRef(null);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusables = Array.from(
        panelRef.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

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

  const parentLabel = parent?.name ?? "this block";
  const afterLabel = afterId == null ? "at the end" : "after the chosen item";

  return (
    <div className="showcase-manager-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="showcase-manager showcase-add-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
      >
        <div className="showcase-manager-head">
          <h2 className="showcase-manager-title" id={titleId}>
            Add to “{parentLabel}”
          </h2>
          <p className="showcase-manager-subtitle">
            Add a real note from the library or a placeholder to fill in
            later. New cards land {afterLabel}.
          </p>
          <button
            aria-label="Close add dialog"
            className="button showcase-add-close"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>

        <div
          aria-label="What to add"
          className="showcase-picker-modes showcase-add-modes"
          role="tablist"
        >
          <button
            aria-selected={mode === "notes"}
            className="showcase-picker-mode"
            onClick={() => setMode("notes")}
            role="tab"
            type="button"
          >
            Notes
          </button>
          <button
            aria-selected={mode === "catalog"}
            className="showcase-picker-mode"
            onClick={() => setMode("catalog")}
            role="tab"
            type="button"
          >
            Placeholder
          </button>
          <button
            aria-selected={mode === "grouping"}
            className="showcase-picker-mode"
            onClick={() => setMode("grouping")}
            role="tab"
            type="button"
          >
            Grouping
          </button>
        </div>

        <div className="showcase-add-body" role="tabpanel">
          {mode === "notes" ? (
            <ShowcaseNotePicker
              collections={collections}
              embedded
              node={parent}
              onAdd={async (noteIds, allNotes) => {
                await onAddNotes(noteIds, allNotes);
                onClose();
              }}
              onClose={onClose}
            />
          ) : mode === "catalog" ? (
            <ShowcaseCatalogShellForm
              onAdd={onAddShells}
              onClose={onClose}
              parentLabel={parentLabel}
            />
          ) : (
            <GroupingNameForm onAdd={onAddGrouping} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

export { ShowcaseAddDialog };
