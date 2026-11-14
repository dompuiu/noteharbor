import { useEffect, useId, useRef, useState } from "react";
import {
  catalogEntryCaption,
  catalogEntryIdentity,
  normalizeCatalogEntry,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// Split the Add catalog entry field into catalog numbers. The shared
// denomination, date, and source apply to every position in the list, so the
// form plans several unseen entries in one submit. Commas are the only
// separator for now.
function parseCatalogNumbers(raw) {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// The add/edit form for Catalog entries. Editing a draft entry prefills its
// metadata and replaces it whole; adding splits the catalog-number field so one
// shared denomination, date, and source plan several unseen positions at once.
// A live preview paints the unseen card each entry will become, and every
// submit only touches the local draft: Save replays it.
function ShowcaseCatalogEntryForm({
  entry = null,
  onAdd,
  onClose,
  onSave,
  parentLabel = "this block",
}) {
  const editing = entry != null;
  const titleId = useId();
  const [catalogs, setCatalogs] = useState(entry?.catalog_number ?? "");
  const [denomination, setDenomination] = useState(entry?.denomination ?? "");
  const [issueDate, setIssueDate] = useState(entry?.issue_date ?? "");
  const [source, setSource] = useState(entry?.source ?? "");
  const catalogsRef = useRef(null);
  const formRef = useRef(null);

  // Escape closes; Tab stays inside the modal, wrapping at both ends like the
  // specimen manager and the app's other dialogs.
  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }

    if (event.key !== "Tab" || !formRef.current) {
      return;
    }

    const focusables = Array.from(
      formRef.current.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    );

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

  // Opening the form selects an existing catalog value so retyping it is one
  // keystroke, the same hand-off the showcase name field uses.
  useEffect(() => {
    catalogsRef.current?.focus();
    if (editing) {
      catalogsRef.current?.select?.();
    }
  }, [editing]);

  const catalogNumbers = editing
    ? (catalogs.trim() ? [catalogs.trim()] : [])
    : parseCatalogNumbers(catalogs);
  const entryCount = catalogNumbers.length;
  const previewEntry = normalizeCatalogEntry({
    catalog_number: catalogNumbers[0] ?? "",
    denomination,
    issue_date: issueDate,
    source,
  });
  const previewIdentity = catalogEntryIdentity(previewEntry);
  const previewCaption = catalogEntryCaption(previewEntry);
  const canSubmit = entryCount > 0;
  const submitLabel = editing
    ? "Save entry"
    : entryCount
      ? `Add ${entryCount} ${entryCount === 1 ? "entry" : "entries"}`
      : "Add entries";

  function submit(event) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const details = { denomination, issue_date: issueDate, source };

    if (editing) {
      onSave?.(
        normalizeCatalogEntry({
          ...details,
          catalog_number: catalogNumbers[0],
        }),
      );
    } else {
      onAdd?.(
        catalogNumbers.map((catalogNumber) =>
          normalizeCatalogEntry({ ...details, catalog_number: catalogNumber }),
        ),
      );
    }

    onClose?.();
  }

  return (
    <div
      className="showcase-manager-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <form
        aria-labelledby={titleId}
        aria-modal="true"
        className="showcase-manager showcase-entry-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        onSubmit={submit}
        ref={formRef}
        role="dialog"
      >
        <div className="showcase-manager-head">
          <h2 className="showcase-manager-title" id={titleId}>
            {editing ? "Edit catalog entry" : "Add catalog entries"}
          </h2>
          <p className="showcase-manager-subtitle">
            {editing
              ? "This changes the position's catalog metadata. A linked note keeps its own record."
              : "Positions start unseen. Link a reference photo or mark one owned later."}
          </p>
        </div>

        <div className="showcase-manager-scroll">
          <div className="showcase-entry-grid">
            <div className="showcase-entry-fields">
              <label className="field-block">
                <span>{editing ? "Catalog number" : "Catalog numbers"}</span>
                <input
                  aria-label={editing ? "Catalog number" : "Catalog numbers"}
                  onChange={(event) => setCatalogs(event.target.value)}
                  placeholder={editing ? "22a" : "22a, 22b, 22c"}
                  ref={catalogsRef}
                  type="text"
                  value={catalogs}
                />
              </label>

              <div className="showcase-entry-row">
                <label className="field-block">
                  <span>Denomination</span>
                  <input
                    aria-label="Denomination"
                    onChange={(event) => setDenomination(event.target.value)}
                    placeholder="20 lei"
                    type="text"
                    value={denomination}
                  />
                </label>
                <label className="field-block">
                  <span>Issue date</span>
                  <input
                    aria-label="Issue date"
                    onChange={(event) => setIssueDate(event.target.value)}
                    placeholder="1877"
                    type="text"
                    value={issueDate}
                  />
                </label>
              </div>

              <label className="field-block">
                <span>Source (optional)</span>
                <input
                  aria-label="Source"
                  onChange={(event) => setSource(event.target.value)}
                  placeholder="Pick catalog, a friend's collection…"
                  type="text"
                  value={source}
                />
              </label>
            </div>

            <div className="showcase-entry-preview">
              <p className="muted showcase-entry-preview-label">
                Specimen preview
              </p>
              <div className="showcase-entry-preview-card">
                <ShowcaseCatalogWell identity={previewIdentity} />
                <span className="showcase-card-caption-row">
                  <span className="showcase-card-caption">{previewCaption}</span>
                </span>
                <span className="showcase-catalog-foot">
                  <span aria-hidden="true" className="showcase-check-empty" />
                  <span>Add notes</span>
                  <span aria-hidden="true" className="showcase-catalog-arrow">
                    →
                  </span>
                </span>
              </div>
              <p aria-live="polite" className="muted showcase-entry-count">
                {editing
                  ? `Updates ${previewIdentity} in this draft.`
                  : `${entryCount} unseen ${
                      entryCount === 1 ? "entry" : "entries"
                    } will be added to ${parentLabel}.`}
              </p>
            </div>
          </div>
        </div>

        <div className="showcase-manager-foot">
          <button className="button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={!canSubmit}
            type="submit"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export { ShowcaseCatalogEntryForm };
