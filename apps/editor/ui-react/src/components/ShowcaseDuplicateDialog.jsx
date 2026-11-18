import { useId, useState } from "react";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";

// The list already carries each Showcase's placed pool labels, so a target that
// cannot take this category is disabled without reading every other tree. A
// stale list still meets the server's own one-placement-per-label rule.
function placesCategory(showcase, categoryId) {
  return categoryId != null && (showcase.category_ids ?? []).includes(categoryId);
}

function entryCount(showcase) {
  const count = Number.isInteger(showcase.entry_count)
    ? showcase.entry_count
    : 0;
  return `${count} ${count === 1 ? "entry" : "entries"}`;
}

// Copy the chosen Category subtree into another Showcase. The copy is a
// separate placement: notes are referenced, and the source stays untouched.
function ShowcaseDuplicateDialog({
  category,
  showcases = [],
  onClose,
  onDuplicate,
}) {
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(
    () =>
      showcases.find((showcase) => !placesCategory(showcase, category?.category_id))
        ?.id ?? null,
  );

  async function submit(event) {
    event.preventDefault();

    if (selectedId == null || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onDuplicate(selectedId);
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || "Could not duplicate the category.");
      setBusy(false);
    }
  }

  return (
    <ShowcaseDialog
      onClose={busy ? undefined : onClose}
      subtitle="Copies the category and everything inside it. The copy is independent."
      title="Duplicate category"
    >
      <form className="showcase-name-dialog" onSubmit={submit}>
        <p className="muted" id={headingId}>
          {`Copy “${category?.name ?? "this category"}” into another showcase.`}
        </p>

        <div
          aria-labelledby={headingId}
          className="showcase-manager-list"
          role="radiogroup"
        >
          {showcases.map((showcase) => {
            const placed = placesCategory(showcase, category?.category_id);
            const reasonId = `${headingId}-placed-${showcase.id}`;

            return (
              <div className="showcase-manager-row" key={showcase.id}>
                <label className="showcase-manager-choice">
                  <input
                    aria-describedby={placed ? reasonId : undefined}
                    autoFocus={selectedId === showcase.id}
                    checked={selectedId === showcase.id}
                    disabled={placed || busy}
                    name="duplicate-showcase"
                    onChange={() => {
                      setError("");
                      setSelectedId(showcase.id);
                    }}
                    type="radio"
                    value={showcase.id}
                  />
                  <span className="showcase-manager-note">
                    {showcase.name}
                  </span>
                  <span className="showcase-manager-chip">
                    {entryCount(showcase)}
                  </span>
                </label>
                {placed ? (
                  <span className="muted" id={reasonId}>
                    Already in this showcase
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="showcase-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="showcase-shell-form-actions">
          <button
            className="button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={busy || selectedId == null}
            type="submit"
          >
            {busy ? "Duplicating…" : "Duplicate"}
          </button>
        </div>
      </form>
    </ShowcaseDialog>
  );
}

export { ShowcaseDuplicateDialog };
