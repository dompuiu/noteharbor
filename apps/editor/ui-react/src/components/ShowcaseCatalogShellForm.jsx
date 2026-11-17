import { useRef, useState } from "react";
import {
  catalogEntryCaption,
  catalogEntryIdentity,
  normalizeCatalogEntry,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// Shared by the merged Add dialog and the Edit details dialog. A catalog shell
// is only a planned position: catalog metadata, no note. Commas split several
// shells that share the remaining fields.
function parseCatalogNumbers(raw) {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function ShowcaseCatalogShellForm({
  entry = null,
  onAdd,
  onClose,
  parentLabel = "this Category or Grouping",
  submitLabel = "Add placeholders",
}) {
  const editing = entry != null;
  const [catalogs, setCatalogs] = useState(entry?.catalog_number ?? "");
  const [denomination, setDenomination] = useState(
    entry?.denomination ?? "",
  );
  const [issueDate, setIssueDate] = useState(entry?.issue_date ?? "");
  const [source, setSource] = useState(entry?.source ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstFieldRef = useRef(null);

  const catalogNumbers = editing
    ? catalogs.trim()
      ? [catalogs.trim()]
      : []
    : parseCatalogNumbers(catalogs);
  const entryCount = catalogNumbers.length;
  const preview = normalizeCatalogEntry({
    catalog_number: catalogNumbers[0] ?? "",
    denomination,
    issue_date: issueDate,
    source,
  });
  const previewIdentity = catalogEntryIdentity(preview);
  const canSubmit = entryCount > 0 && !busy;

  async function submit(event) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const details = { denomination, issue_date: issueDate, source };
    const entries = editing
      ? [normalizeCatalogEntry({ ...details, catalog_number: catalogNumbers[0] })]
      : catalogNumbers.map((catalogNumber) =>
          normalizeCatalogEntry({ ...details, catalog_number: catalogNumber }),
        );

    setBusy(true);
    setError("");

    try {
      await onAdd?.(entries);
      onClose?.();
    } catch (submitError) {
      setError(submitError.message || "Could not add the placeholders.");
      setBusy(false);
    }
  }

  return (
    <form className="showcase-shell-form" onSubmit={submit}>
      <div className="showcase-shell-form-grid">
        <div className="showcase-entry-fields">
          <label className="field-block">
            <span>{editing ? "Catalog number" : "Catalog numbers"}</span>
            <input
              aria-label={editing ? "Catalog number" : "Catalog numbers"}
              autoFocus
              onChange={(event) => setCatalogs(event.target.value)}
              ref={firstFieldRef}
              type="text"
              value={catalogs}
            />
            <small className="field-help">
              {editing
                ? "The catalog value this placeholder holds, for example 22a."
                : "One placeholder per catalog value, separated by commas: 22a, 22b, 22c."}
            </small>
          </label>

          <div className="showcase-entry-row">
            <label className="field-block">
              <span>Denomination</span>
              <input
                aria-label="Denomination"
                onChange={(event) => setDenomination(event.target.value)}
                type="text"
                value={denomination}
              />
              <small className="field-help">For example, 20 lei.</small>
            </label>
            <label className="field-block">
              <span>Issue date</span>
              <input
                aria-label="Issue date"
                onChange={(event) => setIssueDate(event.target.value)}
                type="text"
                value={issueDate}
              />
              <small className="field-help">For example, 1877.</small>
            </label>
          </div>

          <label className="field-block">
            <span>Source (optional)</span>
            <input
              aria-label="Source"
              onChange={(event) => setSource(event.target.value)}
              type="text"
              value={source}
            />
            <small className="field-help">
              Where the planned card comes from, for example a catalog.
            </small>
          </label>
        </div>

        <div className="showcase-entry-preview">
          <p className="muted showcase-entry-preview-label">
            Placeholder preview
          </p>
          <div className="showcase-entry-preview-card">
            <ShowcaseCatalogWell identity={previewIdentity} />
            <span className="showcase-card-caption-row">
              <span className="showcase-card-caption">
                {catalogEntryCaption(preview)}
              </span>
            </span>
            <span className="showcase-catalog-foot">
              <span>Replace with a note</span>
              <span aria-hidden="true" className="showcase-catalog-arrow">
                →
              </span>
            </span>
          </div>
          <p aria-live="polite" className="muted showcase-entry-count">
            {editing
              ? `Updates ${previewIdentity}.`
              : `${entryCount} ${
                  entryCount === 1 ? "placeholder" : "placeholders"
                } will be added to ${parentLabel}.`}
          </p>
        </div>
      </div>

      {error ? (
        <p className="showcase-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="showcase-shell-form-actions">
        {onClose ? (
          <button className="button" onClick={onClose} type="button">
            Cancel
          </button>
        ) : null}
        <button className="button button-primary" disabled={!canSubmit} type="submit">
          {editing
            ? "Save details"
            : entryCount
              ? `Add ${entryCount} ${entryCount === 1 ? "placeholder" : "placeholders"}`
              : submitLabel}
        </button>
      </div>
    </form>
  );
}

export { ShowcaseCatalogShellForm };
