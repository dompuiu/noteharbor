import { useEffect, useId, useState } from "react";
import { getShowcaseTree } from "../lib/api.js";
import { containerNodes } from "../lib/showcaseTree.js";
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

// Copy the chosen Category or Grouping subtree into another Showcase. The copy
// is independent: notes are referenced, and the source stays untouched. A
// Grouping is not top-level, so it also asks for the parent that will hold it.
function ShowcaseDuplicateDialog({
  source,
  showcases = [],
  onClose,
  onDuplicate,
}) {
  const headingId = useId();
  const parentHeadingId = useId();
  const isGrouping = source?.node_type === "grouping";
  const noun = isGrouping ? "grouping" : "category";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(() => {
    if (isGrouping) {
      return showcases[0]?.id ?? null;
    }

    return (
      showcases.find(
        (showcase) => !placesCategory(showcase, source?.category_id),
      )?.id ?? null
    );
  });
  const [parentId, setParentId] = useState(null);
  const [tree, setTree] = useState({
    status: "loading",
    choices: [],
    error: "",
  });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!isGrouping || selectedId == null) {
      return;
    }

    let active = true;
    setTree({ status: "loading", choices: [], error: "" });
    setParentId(null);

    getShowcaseTree(selectedId)
      .then((payload) => {
        if (!active) {
          return;
        }

        const choices = containerNodes(payload?.nodes);
        setTree({ status: "ready", choices, error: "" });
        setParentId(choices[0]?.id ?? null);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }

        setTree({
          status: "failed",
          choices: [],
          error: loadError.message || "Could not load the showcase.",
        });
      });

    return () => {
      active = false;
    };
  }, [isGrouping, selectedId, retryCount]);

  async function submit(event) {
    event.preventDefault();

    if (selectedId == null || busy) {
      return;
    }

    if (isGrouping && parentId == null) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await onDuplicate(selectedId, isGrouping ? parentId : undefined);
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || `Could not duplicate the ${noun}.`);
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    selectedId != null &&
    (!isGrouping || (tree.status === "ready" && parentId != null));
  const selectedShowcaseName = showcases.find(
    (showcase) => showcase.id === selectedId,
  )?.name;

  return (
    <ShowcaseDialog
      onClose={busy ? undefined : onClose}
      subtitle={`Copies the ${noun} and everything inside it. The copy is independent.`}
      title={`Duplicate “${source?.name ?? `this ${noun}`}”`}
    >
      <form className="showcase-name-dialog" onSubmit={submit}>
        <p className="muted" id={headingId}>
          {`Copy “${source?.name ?? `this ${noun}`}” into another showcase.`}
        </p>

        <div
          aria-labelledby={headingId}
          className="showcase-manager-list"
          role="radiogroup"
        >
          {showcases.map((showcase) => {
            const placed =
              !isGrouping &&
              placesCategory(showcase, source?.category_id);
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

        {isGrouping ? (
          <div className="showcase-duplicate-parents">
            <p className="muted" id={parentHeadingId}>
              {`Copy into ${selectedShowcaseName ?? "the chosen showcase"}`}
            </p>

            {tree.status === "loading" ? (
              <p className="muted" role="status">
                Loading showcase contents…
              </p>
            ) : null}

            {tree.status === "failed" ? (
              <div className="showcase-duplicate-load-error">
                <p className="showcase-error" role="alert">
                  {tree.error}
                </p>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setRetryCount((count) => count + 1)}
                  type="button"
                >
                  Try again
                </button>
              </div>
            ) : null}

            {tree.status === "ready" && tree.choices.length === 0 ? (
              <p className="muted">
                This showcase has no category or grouping to hold the copy.
              </p>
            ) : null}

            {tree.status === "ready" && tree.choices.length > 0 ? (
              <div
                aria-labelledby={parentHeadingId}
                className="showcase-manager-list"
                role="radiogroup"
              >
                {tree.choices.map((choice) => (
                  <div className="showcase-manager-row" key={choice.id}>
                    <label className="showcase-manager-choice">
                      <input
                        checked={parentId === choice.id}
                        disabled={busy}
                        name="duplicate-parent"
                        onChange={() => {
                          setError("");
                          setParentId(choice.id);
                        }}
                        type="radio"
                        value={choice.id}
                      />
                      <span className="showcase-manager-note">
                        {choice.path.join(" › ")}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

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
            disabled={!canSubmit}
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
