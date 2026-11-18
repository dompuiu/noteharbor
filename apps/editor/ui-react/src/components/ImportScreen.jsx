import { useEffect, useRef, useState } from "react";
import {
  clearAppData,
  exportArchive,
  getOperationStatus,
  importArchive,
} from "../lib/api.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import { assignLocation } from "../lib/navigation.js";
import { clearAllTableStates } from "../lib/notesTableState.js";
import { useConfirmation } from "./ConfirmDialog.jsx";

function isArchiveFile(file) {
  return Boolean(
    file &&
      (file.type === "application/zip" ||
        file.name.toLowerCase().endsWith(".zip")),
  );
}

function getDroppedArchiveFile(event) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  return files.find((file) => isArchiveFile(file)) ?? null;
}

function formatOperationLabel(operation) {
  return String(operation || "idle").replace(/_/g, " ");
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Shared line-art shell: every glyph on this screen draws on the same 24px
   grid, so only the paths and the stroke weight differ. */
function Glyph({ children, strokeWidth = 1.7 }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

function ImportGlyph() {
  return (
    <Glyph>
      <path d="M12 3v10.5" />
      <path d="m8 9.5 4 4 4-4" />
      <path d="M4 15.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    </Glyph>
  );
}

function ExportGlyph() {
  return (
    <Glyph>
      <path d="M12 13.5V3" />
      <path d="m8 7 4-4 4 4" />
      <path d="M4 15.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5" />
    </Glyph>
  );
}

function ArchiveGlyph() {
  return (
    <Glyph strokeWidth={1.6}>
      <path d="M4 7.5h16v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5Z" />
      <path d="M3 4h18v3.5H3z" />
      <path d="M10 12h4" />
    </Glyph>
  );
}

/* One record picker: the collections list and the showcases list are the same
   control over different data, so the label, the count and the chip row are
   written once. `onToggle` owns the selection rules, including the showcase's
   pull on its collections. */
function ExportSelectionList({
  ariaLabel,
  disabled,
  emptyText,
  items,
  label,
  onToggle,
  selectedIds,
  help,
}) {
  return (
    <div className="field-block">
      <span>
        {label}
        <span className="import-count" aria-hidden="true">
          {selectedIds.length}/{items.length}
        </span>
      </span>
      <div
        className="export-collection-list"
        role="group"
        aria-label={ariaLabel}
      >
        {items.length ? (
          items.map((item) => {
            const id = Number(item.id);

            return (
              <label className="export-collection-option" key={item.id}>
                <input
                  checked={selectedIds.includes(id)}
                  disabled={disabled}
                  onChange={(event) => onToggle(id, event.target.checked)}
                  type="checkbox"
                />
                <span>{item.name}</span>
              </label>
            );
          })
        ) : (
          <p className="import-empty">{emptyText}</p>
        )}
      </div>
      {help ? <p className="field-help">{help}</p> : null}
    </div>
  );
}

function ImportScreen({
  collections,
  collectionsError,
  loadingCollections,
  showcases = [],
  showcasesError = "",
  loadingShowcases = false,
}) {
  const archiveInputRef = useRef(null);
  const panelScrollRef = useRef(null);
  const [archiveSource, setArchiveSource] = useState(null);
  const [importMode, setImportMode] = useState("replace");
  const [archiveDropActive, setArchiveDropActive] = useState(false);
  const [archiveResult, setArchiveResult] = useState(null);
  const [error, setError] = useState("");
  const [submittingArchive, setSubmittingArchive] = useState(false);
  const [exportingArchive, setExportingArchive] = useState(false);
  const [archiveUploadProgress, setArchiveUploadProgress] = useState(null);
  const [clearingData, setClearingData] = useState(false);
  const [operationStatus, setOperationStatus] = useState({
    currentOperation: "idle",
    isBusy: false,
    startedAt: null,
    details: null,
  });
  const [selectedExportCollectionIds, setSelectedExportCollectionIds] =
    useState([]);
  const [selectedExportShowcaseIds, setSelectedExportShowcaseIds] =
    useState([]);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const {
    confirm: requestConfirmation,
    dialog: confirmDialog,
    isOpen: confirmOpen,
  } = useConfirmation();

  const isBusy = operationStatus.isBusy;
  const isTransferring = submittingArchive || exportingArchive;
  const busyMessage = isBusy
    ? `This action is unavailable while ${formatOperationLabel(operationStatus.currentOperation)} is in progress.`
    : "";

  function setArchiveImportSource(nextSource) {
    setArchiveSource(nextSource);
    setArchiveResult(null);
    setError("");
  }

  useEffect(() => {
    const validIds = collections
      .map((collection) => Number(collection.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    setSelectedExportCollectionIds((current) => {
      const currentSet = new Set(current);
      const retained = validIds.filter((id) => currentSet.has(id));

      if (!retained.length) {
        return validIds;
      }

      if (
        retained.length === current.length &&
        retained.every((id, index) => id === current[index])
      ) {
        return current;
      }

      return retained;
    });
  }, [collections]);

  useEffect(() => {
    const validIds = showcases
      .map((showcase) => Number(showcase.id))
      .filter((id) => Number.isInteger(id) && id > 0);

    setSelectedExportShowcaseIds((current) => {
      const currentSet = new Set(current);
      const retained = validIds.filter((id) => currentSet.has(id));

      if (!retained.length) {
        return validIds;
      }

      if (
        retained.length === current.length &&
        retained.every((id, index) => id === current[index])
      ) {
        return current;
      }

      return retained;
    });
  }, [showcases]);

  function updatePanelScrollFades() {
    const element = panelScrollRef.current;

    if (!element) {
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }

    const nextCanScrollUp = element.scrollTop > 1;
    const remaining =
      element.scrollHeight - element.clientHeight - element.scrollTop;
    const nextCanScrollDown = remaining > 1;

    setCanScrollUp(nextCanScrollUp);
    setCanScrollDown(nextCanScrollDown);
  }

  useEffect(() => {
    updatePanelScrollFades();

    const timer = window.setTimeout(updatePanelScrollFades, 0);
    window.addEventListener("resize", updatePanelScrollFades);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updatePanelScrollFades);
    };
  }, [
    archiveResult,
    collections.length,
    error,
    loadingCollections,
    loadingShowcases,
    selectedExportCollectionIds.length,
    selectedExportShowcaseIds.length,
    showcases.length,
  ]);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const payload = await getOperationStatus();
        if (active) {
          setOperationStatus(payload);
        }
      } catch {
        if (active) {
          setOperationStatus((current) => current);
        }
      }
    }

    loadStatus();
    const timer = window.setInterval(loadStatus, isTransferring ? 500 : 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isTransferring]);

  async function handleArchiveImport(event) {
    event.preventDefault();

    if (!archiveSource) {
      setError("Choose a .zip archive before importing.");
      return;
    }

    if (isBusy) {
      setError(busyMessage);
      return;
    }

    const isReplace = importMode === "replace";
    const confirmed = await requestConfirmation({
      title: isReplace
        ? "Importing an archive will replace ALL current data."
        : "Importing an archive will replace collections that exist in the archive (by name).",
      body: isReplace
        ? "Collections, showcases, and pictures missing from the archive will be deleted. Continue?"
        : "Collections missing from the archive stay untouched. Continue?",
      confirmLabel: "Import",
    });

    if (!confirmed) {
      return;
    }

    setSubmittingArchive(true);
    setArchiveUploadProgress(null);
    setError("");
    setArchiveResult(null);

    try {
      await importArchive(archiveSource, setArchiveUploadProgress, importMode);
      // Import renumbers collections, so the saved per-collection table
      // structure no longer names the same collections. Drop it before the
      // reload picks the new ids up.
      clearAllTableStates();
      setArchiveResult({ success: true });
      assignLocation(CATALOG_ROUTES.collections);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSubmittingArchive(false);
      setArchiveUploadProgress(null);
    }
  }

  // The collections each selected showcase needs to work. Selecting a
  // showcase auto-selects its collections; deselecting a needed collection
  // while the showcase stays selected blocks the export below.
  const requiredCollectionIdsByShowcaseId = new Map(
    showcases.map((showcase) => [
      Number(showcase.id),
      (showcase.required_collection_ids ?? [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ]),
  );
  const collectionNameById = new Map(
    collections.map((collection) => [Number(collection.id), collection.name]),
  );
  const blockedShowcases = showcases.filter((showcase) => {
    if (!selectedExportShowcaseIds.includes(Number(showcase.id))) {
      return false;
    }

    const required =
      requiredCollectionIdsByShowcaseId.get(Number(showcase.id)) ?? [];
    return required.some(
      (collectionId) => !selectedExportCollectionIds.includes(collectionId),
    );
  });
  const blockedExportMessage = blockedShowcases.length
    ? blockedShowcases
        .map((showcase) => {
          const missing = (
            requiredCollectionIdsByShowcaseId.get(Number(showcase.id)) ?? []
          )
            .filter((id) => !selectedExportCollectionIds.includes(id))
            .map((id) => collectionNameById.get(id) ?? `#${id}`);
          return `Showcase "${showcase.name}" needs ${missing.map((name) => `"${name}"`).join(", ")}`;
        })
        .join("; ") + ". Select the missing collections or deselect the showcase."
    : "";
  const isExportBlocked = blockedShowcases.length > 0;

  function handleCollectionToggle(collectionId, checked) {
    setSelectedExportCollectionIds((current) => {
      if (checked) {
        return current.includes(collectionId)
          ? current
          : [...current, collectionId];
      }

      return current.filter((id) => id !== collectionId);
    });
  }

  function handleShowcaseToggle(showcaseId, checked) {
    if (checked) {
      setSelectedExportShowcaseIds((current) => {
        if (current.includes(showcaseId)) {
          return current;
        }
        return [...current, showcaseId];
      });

      // A showcase only works with its collections in the archive, so
      // selecting it pulls those collections into the export.
      const required =
        requiredCollectionIdsByShowcaseId.get(showcaseId) ?? [];
      if (required.length) {
        setSelectedExportCollectionIds((current) => {
          const missing = required.filter((id) => !current.includes(id));
          return missing.length ? [...current, ...missing] : current;
        });
      }
      return;
    }

    setSelectedExportShowcaseIds((current) =>
      current.filter((id) => id !== showcaseId),
    );
  }

  async function handleArchiveExport() {
    if (isBusy) {
      setError(busyMessage);
      return;
    }

    if (isExportBlocked) {
      setError(blockedExportMessage);
      return;
    }

    setExportingArchive(true);
    setError("");
    setArchiveResult(null);

    try {
      const payload = await exportArchive(
        selectedExportCollectionIds,
        selectedExportShowcaseIds,
      );

      // A null payload means the desktop shell's save dialog was dismissed:
      // there is no file to report and nothing to explain.
      if (!payload) {
        return;
      }

      setArchiveResult({
        exported: payload.filename,
        path: payload.path ?? "",
        selectedCount: selectedExportCollectionIds.length,
        selectedShowcaseCount: selectedExportShowcaseIds.length,
        omittedShowcases: payload.omittedShowcases ?? [],
      });
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExportingArchive(false);
    }
  }

  async function handleClearData() {
    if (isBusy) {
      setError(busyMessage);
      return;
    }

    const confirmed = await requestConfirmation({
      title: "Delete all current app data and pictures?",
      body: "This cannot be undone.",
      confirmLabel: "Delete data",
    });

    if (!confirmed) {
      return;
    }

    setClearingData(true);
    setError("");
    setArchiveResult(null);

    try {
      await clearAppData();
      assignLocation(CATALOG_ROUTES.collections);
    } catch (clearError) {
      setError(clearError.message);
    } finally {
      setClearingData(false);
    }
  }

  const scrollFadeClass =
    canScrollUp && canScrollDown
      ? " import-panel-scroll--fade-both"
      : canScrollUp
        ? " import-panel-scroll--fade-top"
        : canScrollDown
          ? " import-panel-scroll--fade-bottom"
          : "";
  const archiveSize = formatFileSize(archiveSource?.size);
  const exportSummary = `${selectedExportCollectionIds.length} of ${collections.length} collections · ${selectedExportShowcaseIds.length} of ${showcases.length} showcases`;

  return (
    <section className="screen-stack narrow-stack import-screen">
      {confirmDialog}
      <div className="panel import-panel">
        <div
          className={`import-panel-scroll${scrollFadeClass}`}
          onScroll={updatePanelScrollFades}
          ref={panelScrollRef}
        >
          <header className="import-head">
            <div className="import-head-copy">
              <p className="eyebrow">Archive Import and Export</p>
              <h1>Move your archive in and out</h1>
              <p className="import-lede">
                One .zip carries your collections, your showcases, and only the
                pictures they reference. An import can replace data, so export
                a copy first if you need one.
              </p>
            </div>
            <dl className="import-facts" aria-label="Current catalog">
              <div className="import-fact">
                <dt>Collections</dt>
                <dd>{loadingCollections ? "—" : collections.length}</dd>
              </div>
              <div className="import-fact">
                <dt>Showcases</dt>
                <dd>{loadingShowcases ? "—" : showcases.length}</dd>
              </div>
              <div className="import-fact">
                <dt>Archive</dt>
                <dd>.zip</dd>
              </div>
            </dl>
          </header>

          {loadingCollections ? (
            <p className="import-status-line">Loading collections…</p>
          ) : null}
          {collectionsError ? (
            <p className="error-text">{collectionsError}</p>
          ) : null}
          {loadingShowcases ? (
            <p className="import-status-line">Loading showcases…</p>
          ) : null}
          {showcasesError ? (
            <p className="error-text">{showcasesError}</p>
          ) : null}
          {isBusy && !isTransferring ? (
            <p className="warning-text">{busyMessage}</p>
          ) : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}

          <div className="import-grid">
            <form
              className="import-card"
              onSubmit={handleArchiveImport}
            >
              <div className="import-card-head">
                <span className="import-card-glyph" aria-hidden="true">
                  <ImportGlyph />
                </span>
                <div className="import-card-copy">
                  <p className="eyebrow">Bring data in</p>
                  <h2>Import an archive</h2>
                  <p>
                    Restore a backup or move a catalog between machines.
                  </p>
                </div>
              </div>

              <div className="field-block">
                <span>How to apply it</span>
                <div
                  className="import-mode-grid"
                  role="radiogroup"
                  aria-label="Import mode"
                >
                  <label className="import-mode-option">
                    <input
                      checked={importMode === "replace"}
                      disabled={isBusy || submittingArchive}
                      name="import-mode"
                      onChange={() => setImportMode("replace")}
                      type="radio"
                      value="replace"
                    />
                    <span className="import-mode-copy">
                      <strong>Replace everything</strong>
                      <span>
                        The archive becomes the catalog. Whatever it does not
                        contain is deleted.
                      </span>
                    </span>
                  </label>
                  <label className="import-mode-option">
                    <input
                      checked={importMode === "merge"}
                      disabled={isBusy || submittingArchive}
                      name="import-mode"
                      onChange={() => setImportMode("merge")}
                      type="radio"
                      value="merge"
                    />
                    <span className="import-mode-copy">
                      <strong>Merge by name</strong>
                      <span>
                        Collections named in the archive are rebuilt; everything
                        else stays as it is.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className="field-block">
                <span>Archive file</span>
                <div
                  className={`image-dropzone import-dropzone${archiveDropActive ? " image-dropzone--active" : ""}${archiveSource ? " import-dropzone--filled" : ""}`}
                  onClick={() => {
                    if (!isBusy) {
                      archiveInputRef.current?.click();
                    }
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setArchiveDropActive(true);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) {
                      return;
                    }

                    setArchiveDropActive(false);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setArchiveDropActive(true);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setArchiveDropActive(false);

                    if (isBusy) {
                      return;
                    }

                    const droppedFile = getDroppedArchiveFile(event);
                    if (droppedFile) {
                      setArchiveImportSource(droppedFile);
                    }
                  }}
                  onFocus={() => setArchiveDropActive(true)}
                  onBlur={() => setArchiveDropActive(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!isBusy) {
                        archiveInputRef.current?.click();
                      }
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="import-dropzone-content">
                    <span className="import-dropzone-glyph" aria-hidden="true">
                      <ArchiveGlyph />
                    </span>
                    <strong>
                      {archiveSource?.name || "Drop a .zip archive here"}
                    </strong>
                    <p className="import-dropzone-help">
                      {archiveSource
                        ? `${archiveSize ? `${archiveSize} · ` : ""}ready to import`
                        : "or choose a file from your computer"}
                    </p>
                  </div>
                </div>
                <div className="import-actions">
                  <button
                    className="button"
                    disabled={isBusy}
                    onClick={() => archiveInputRef.current?.click()}
                    type="button"
                  >
                    Choose archive
                  </button>
                  <button
                    className="import-clear"
                    disabled={!archiveSource || isBusy}
                    onClick={() => {
                      setArchiveImportSource(null);
                      if (archiveInputRef.current) {
                        archiveInputRef.current.value = "";
                      }
                    }}
                    type="button"
                  >
                    Clear file
                  </button>
                  <input
                    accept=".zip,application/zip"
                    className="image-slot-input"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null;
                      if (isArchiveFile(file)) {
                        setArchiveImportSource(file);
                      }
                    }}
                    ref={archiveInputRef}
                    type="file"
                  />
                </div>
              </div>

              <div className="import-card-footer">
                <p className="import-footnote">
                  If the import fails, nothing changes. The archive is checked
                  before it is applied.
                </p>
                <button
                  className="button button-primary"
                  disabled={submittingArchive || isBusy || !archiveSource}
                  type="submit"
                >
                  Import archive
                </button>
              </div>
            </form>

            <section
              aria-labelledby="import-export-title"
              className="import-card"
            >
              <div className="import-card-head">
                <span className="import-card-glyph" aria-hidden="true">
                  <ExportGlyph />
                </span>
                <div className="import-card-copy">
                  <p className="eyebrow">Take data out</p>
                  <h2 id="import-export-title">Export an archive</h2>
                  <p>
                    Pack the collections and showcases you choose into one
                    portable .zip. Only the pictures they use travel with them.
                  </p>
                </div>
              </div>

              <ExportSelectionList
                ariaLabel="Collections to export"
                disabled={isBusy || exportingArchive}
                emptyText="No collections yet. Import an archive, or create a collection first."
                items={collections}
                label="Collections to export"
                onToggle={handleCollectionToggle}
                selectedIds={selectedExportCollectionIds}
              />

              <ExportSelectionList
                ariaLabel="Showcases to export"
                disabled={isBusy || exportingArchive}
                emptyText="No showcases yet. A showcase exports together with the collections it uses."
                help="Picking a showcase also picks the collections it needs. The export waits until every one of them is selected."
                items={showcases}
                label="Showcases to export"
                onToggle={handleShowcaseToggle}
                selectedIds={selectedExportShowcaseIds}
              />

              <div className="import-archive-contents">
                <p className="import-archive-contents-title">Inside the .zip</p>
                <ul>
                  <li>
                    <code>banknotes.db</code>
                    <span>The collections and showcases you picked</span>
                  </li>
                  <li>
                    <code>images/</code>
                    <span>Only the pictures those collections use</span>
                  </li>
                </ul>
              </div>

              {isExportBlocked ? (
                <p className="error-text">{blockedExportMessage}</p>
              ) : null}

              <div className="import-card-footer">
                <p className="import-summary" aria-live="polite">
                  {exportSummary}
                </p>
                <button
                  className="button button-primary"
                  disabled={
                    exportingArchive ||
                    isBusy ||
                    isExportBlocked ||
                    !selectedExportCollectionIds.length
                  }
                  onClick={handleArchiveExport}
                  type="button"
                >
                  Download archive
                </button>
              </div>
            </section>
          </div>

          {archiveResult?.exported ? (
            <section className="import-result" role="status">
              <span className="import-result-glyph" aria-hidden="true">
                <ArchiveGlyph />
              </span>
              <div className="import-result-copy">
                <h2>Your archive is ready</h2>
                {archiveResult.path ? (
                  <p className="import-result-file">
                    Saved to {archiveResult.path}
                  </p>
                ) : (
                  <p className="import-result-file">{archiveResult.exported}</p>
                )}
                <p className="import-result-meta">
                  Collections included:{" "}
                  {archiveResult.selectedCount ?? collections.length} · Showcases
                  included: {archiveResult.selectedShowcaseCount ?? 0}
                </p>
                {archiveResult.omittedShowcases?.length ? (
                  <p className="warning-text">
                    Omitted showcases (they use notes outside the selection):{" "}
                    {archiveResult.omittedShowcases.join(", ")}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="import-danger-card">
            <div className="import-danger-copy">
              <p className="eyebrow">Danger zone</p>
              <h2>Start over with an empty catalog</h2>
              <p>
                Deletes every collection, showcase, and picture stored in this
                app. Export an archive first if you may want them back.
              </p>
            </div>
            <button
              className="button button-danger-soft"
              disabled={clearingData || isBusy}
              onClick={handleClearData}
              type="button"
            >
              {clearingData ? "Deleting data..." : "Delete current data"}
            </button>
          </section>
        </div>
      </div>
      {isTransferring ? (
        <div
          className="import-progress-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-live="polite"
          aria-label={
            submittingArchive ? "Importing archive" : "Preparing archive export"
          }
        >
          <div className="import-progress-card">
            <span
              className="scrape-spinner import-progress-spinner"
              aria-hidden="true"
            />
            <p className="import-progress-title">
              {submittingArchive ? "Importing archive..." : "Preparing export..."}
            </p>
            {submittingArchive && archiveSource?.name ? (
              <p className="muted import-progress-detail">
                {archiveSource.name}
              </p>
            ) : null}
            {exportingArchive ? (
              <p className="muted import-progress-detail">
                {selectedExportCollectionIds.length} collection(s),{" "}
                {selectedExportShowcaseIds.length} showcase(s) selected
              </p>
            ) : null}
            {submittingArchive && archiveUploadProgress?.phase === "uploading" &&
            Number.isInteger(archiveUploadProgress?.percent) ? (
              <div className="import-progress-meter">
                <progress
                  value={archiveUploadProgress.percent}
                  max="100"
                  aria-label="Upload progress"
                />
                <span className="muted">
                  {archiveUploadProgress.percent}% uploaded
                </span>
              </div>
            ) : (
              <p className="muted import-progress-detail">
                {exportingArchive
                  ? "Packing the selected records..."
                  : archiveUploadProgress?.phase === "processing"
                    ? "Upload complete. Processing on server..."
                    : "Working..."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export { ImportScreen };
