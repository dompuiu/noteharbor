import { useEffect, useId, useState } from "react";
import { getShowcaseTree } from "../lib/api.js";
import { ShowcaseDialog } from "./ShowcaseDialog.jsx";

// One showcase places a pool label at most once, so a target that already
// places this category is shown but cannot be chosen. The check reads each
// target's tree when the dialog opens; a failed read leaves that row available
// and the server's own re-check decides.
function placesCategory(nodes, category) {
  const categoryId = category?.category_id;
  const name = String(category?.name ?? "").toLowerCase();

  return (nodes ?? []).some(
    (node) =>
      node.node_type === "category" &&
      (categoryId != null && node.category_id != null
        ? node.category_id === categoryId
        : String(node.name ?? "").toLowerCase() === name),
  );
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
  const [selectedId, setSelectedId] = useState(null);
  const [placedIds, setPlacedIds] = useState(() => new Set());
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const targets = showcases;

  useEffect(() => {
    let active = true;
    setChecking(true);

    Promise.all(
      targets.map(async (showcase) => {
        try {
          const tree = await getShowcaseTree(showcase.id);
          return [showcase.id, placesCategory(tree.nodes, category)];
        } catch {
          return [showcase.id, false];
        }
      }),
    ).then((entries) => {
      if (!active) {
        return;
      }

      const placed = new Set(
        entries.filter(([, value]) => value).map(([id]) => id),
      );
      setPlacedIds(placed);
      setChecking(false);
      setSelectedId(
        targets.find((showcase) => !placed.has(showcase.id))?.id ?? null,
      );
    });

    return () => {
      active = false;
    };
  }, [category, targets]);

  async function submit(event) {
    event.preventDefault();

    if (selectedId == null || busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onDuplicate(selectedId);
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

        {targets.length ? (
          <div
            aria-labelledby={headingId}
            className="showcase-manager-list"
            role="radiogroup"
          >
            {targets.map((showcase) => {
              const placed = placedIds.has(showcase.id);

              return (
                <div className="showcase-manager-row" key={showcase.id}>
                  <label className="showcase-manager-choice">
                    <input
                      checked={selectedId === showcase.id}
                      disabled={checking || placed || busy}
                      name="duplicate-showcase"
                      onChange={() => setSelectedId(showcase.id)}
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
                    <span className="muted">Already in this showcase</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">
            There is no other showcase to duplicate into.
          </p>
        )}

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
            disabled={
              busy || checking || selectedId == null || targets.length === 0
            }
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
