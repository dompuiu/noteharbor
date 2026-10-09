import { useEffect, useRef, useState } from "react";
import {
  clearAppData,
  downloadArchive,
  getOperationStatus,
  importArchive,
} from "../lib/api.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
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

function ImportScreen({
  collections,
  collectionsError,
  loadingCollections,
}) {
  const archiveInputRef = useRef(null);
  const panelScrollRef = useRef(null);
  const [archiveSource, setArchiveSource] = useState(null);
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
    selectedExportCollectionIds.length,
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

    const confirmed = await requestConfirmation({
      title:
        "Importing an archive will replace collections that exist in the archive (by name).",
      body: "Collections missing from the archive stay untouched. Continue?",
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
      await importArchive(archiveSource, setArchiveUploadProgress);
      setArchiveResult({ success: true });
      window.location.assign(CATALOG_ROUTES.banknotes);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSubmittingArchive(false);
      setArchiveUploadProgress(null);
    }
  }

  async function handleArchiveExport() {
    if (isBusy) {
      setError(busyMessage);
      return;
    }

    setExportingArchive(true);
    setError("");
    setArchiveResult(null);

    try {
      const payload = await downloadArchive(selectedExportCollectionIds);
      setArchiveResult({
        exported: payload.filename,
        selectedCount: selectedExportCollectionIds.length,
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
      window.location.assign(CATALOG_ROUTES.banknotes);
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

  return (
    <section className="screen-stack narrow-stack import-screen">
      {confirmDialog}
      <div className="panel import-panel">
        <div
          className={`import-panel-scroll${scrollFadeClass}`}
          onScroll={updatePanelScrollFades}
          ref={panelScrollRef}
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Import and Export</p>
              <h1>Manage your collection data</h1>
              <p>
                Archive export can include selected collections only, and
                archive import replaces local collections that exist in the
                archive (matched by name) while leaving other collections
                untouched. Archive import is destructive for collections
                present in the archive: local data for those collections is
                replaced.
              </p>
            </div>
          </div>

          {loadingCollections ? <p>Loading collections...</p> : null}
          {collectionsError ? (
            <p className="error-text">{collectionsError}</p>
          ) : null}
          {isBusy ? <p className="warning-text">{busyMessage}</p> : null}

          <div className="import-sections">
            <form
              className="form-grid import-card"
              onSubmit={handleArchiveImport}
            >
              <div className="full-span">
                <p className="eyebrow">Archive Import and Export</p>
                <h2>Download or import archive data</h2>
                <p>
                  Export downloads a `.zip` with `banknotes.db` and only images
                  referenced by selected collections. Import always reads all
                  collections from the archive and replaces matching collection
                  names in the current data.
                </p>
                <p className="warning-text import-card-warning">
                  You can also delete the current app data and start from an
                  empty collection.
                </p>
              </div>

              <div className="field-block full-span">
                <span>Archive source</span>
                <div
                  className={`image-dropzone import-dropzone${archiveDropActive ? " image-dropzone--active" : ""}`}
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
                    <strong>
                      {archiveSource?.name ||
                        "Drop archive here or choose a file"}
                    </strong>
                    <p className="muted import-dropzone-help">
                      Supports `.zip` archives exported from Note Harbor Editor.
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
                    className="button"
                    disabled={!archiveSource || isBusy}
                    onClick={() => {
                      setArchiveImportSource(null);
                      if (archiveInputRef.current) {
                        archiveInputRef.current.value = "";
                      }
                    }}
                    type="button"
                  >
                    Clear
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

              {collections.length ? (
                <div className="field-block full-span">
                  <span>Collections to export</span>
                  <div
                    className="export-collection-list"
                    role="group"
                    aria-label="Collections to export"
                  >
                    {collections.map((collection) => {
                      const collectionId = Number(collection.id);
                      const checked =
                        selectedExportCollectionIds.includes(collectionId);

                      return (
                        <label
                          className="export-collection-option"
                          key={collection.id}
                        >
                          <input
                            checked={checked}
                            disabled={isBusy || exportingArchive}
                            onChange={(event) => {
                              setSelectedExportCollectionIds((current) => {
                                if (event.target.checked) {
                                  if (current.includes(collectionId)) {
                                    return current;
                                  }
                                  return [...current, collectionId];
                                }

                                return current.filter(
                                  (id) => id !== collectionId,
                                );
                              });
                            }}
                            type="checkbox"
                          />
                          <span>{collection.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="import-actions full-span">
                <button
                  className="button"
                  disabled={
                    exportingArchive ||
                    isBusy ||
                    !selectedExportCollectionIds.length
                  }
                  onClick={handleArchiveExport}
                  type="button"
                >
                  Download archive
                </button>
                <button
                  className="button button-primary"
                  disabled={submittingArchive || isBusy || !archiveSource}
                  type="submit"
                >
                  Import archive
                </button>
                <button
                  className="button button-danger"
                  disabled={clearingData || isBusy}
                  onClick={handleClearData}
                  type="button"
                >
                  {clearingData ? "Deleting data..." : "Delete current data"}
                </button>
              </div>
            </form>
          </div>

          {error ? <p className="error-text">{error}</p> : null}

          {archiveResult?.exported ? (
            <div className="result-card">
              <h2>Archive export started</h2>
              <p>Downloaded: {archiveResult.exported}</p>
              <p>
                Collections included:{" "}
                {archiveResult.selectedCount ?? collections.length}
              </p>
              {archiveResult.omittedShowcases?.length ? (
                <p className="warning-text">
                  Omitted showcases (they use notes outside the selection):{" "}
                  {archiveResult.omittedShowcases.join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}
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
                {selectedExportCollectionIds.length} collection(s) selected
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
                {archiveUploadProgress?.phase === "processing"
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
