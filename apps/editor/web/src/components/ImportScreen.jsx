import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearAppData, downloadArchive, getOperationStatus, importArchive, importCsv } from '../lib/api.js';

function getPastedCsvFile(event) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const fileItem = items.find((item) => item.kind === 'file');
  const file = fileItem?.getAsFile() ?? null;

  if (file && (file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv'))) {
    return file;
  }

  return null;
}

function getPastedCsvText(event) {
  return event.clipboardData?.getData('text/plain')?.trim() ?? '';
}

function getDroppedCsvFile(event) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  return files.find((file) => file.type === 'text/csv' || file.name.toLowerCase().endsWith('.csv')) ?? null;
}

function getDroppedCsvText(event) {
  return event.dataTransfer?.getData('text/plain')?.trim() ?? '';
}

function isArchiveFile(file) {
  return Boolean(file && (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')));
}

function getDroppedArchiveFile(event) {
  const files = Array.from(event.dataTransfer?.files ?? []);
  return files.find((file) => isArchiveFile(file)) ?? null;
}

function formatOperationLabel(operation) {
  return String(operation || 'idle').replace(/_/g, ' ');
}

function ImportScreen({
  activeCollection,
  activeCollectionId,
  collections,
  collectionsError,
  loadingCollections,
  onCreateCollection,
  onDeleteCollection,
  onRenameCollection,
  onSelectCollection,
  onSetDefaultCollection,
  showBackToTable = true,
}) {
  const navigate = useNavigate();
  const csvInputRef = useRef(null);
  const archiveInputRef = useRef(null);
  const [csvSource, setCsvSource] = useState(null);
  const [csvSourceLabel, setCsvSourceLabel] = useState('');
  const [archiveSource, setArchiveSource] = useState(null);
  const [csvDropActive, setCsvDropActive] = useState(false);
  const [archiveDropActive, setArchiveDropActive] = useState(false);
  const [csvResult, setCsvResult] = useState(null);
  const [archiveResult, setArchiveResult] = useState(null);
  const [error, setError] = useState('');
  const [submittingCsv, setSubmittingCsv] = useState(false);
  const [submittingArchive, setSubmittingArchive] = useState(false);
  const [exportingArchive, setExportingArchive] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [operationStatus, setOperationStatus] = useState({
    currentOperation: 'idle',
    isBusy: false,
    startedAt: null,
    details: null
  });
  const [collectionNameDraft, setCollectionNameDraft] = useState('');
  const [collectionActionLoading, setCollectionActionLoading] = useState(false);
  const [selectedExportCollectionIds, setSelectedExportCollectionIds] = useState([]);

  const isBusy = operationStatus.isBusy;
  const busyMessage = isBusy
    ? `This action is unavailable while ${formatOperationLabel(operationStatus.currentOperation)} is in progress.`
    : '';

  function setCsvImportSource(nextSource, label) {
    setCsvSource(nextSource);
    setCsvSourceLabel(label);
    setCsvResult(null);
    setError('');
  }

  function setArchiveImportSource(nextSource) {
    setArchiveSource(nextSource);
    setArchiveResult(null);
    setError('');
  }

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        navigate('/');
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  useEffect(() => {
    const validIds = collections.map((collection) => Number(collection.id)).filter((id) => Number.isInteger(id) && id > 0);

    setSelectedExportCollectionIds((current) => {
      const currentSet = new Set(current);
      const retained = validIds.filter((id) => currentSet.has(id));

      if (!retained.length) {
        return validIds;
      }

      if (retained.length === current.length && retained.every((id, index) => id === current[index])) {
        return current;
      }

      return retained;
    });
  }, [collections]);

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
    const timer = window.setInterval(loadStatus, 2000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  async function handleCsvSubmit(event) {
    event.preventDefault();

    if (!csvSource) {
      setError('Choose, drop, or paste a CSV before importing.');
      return;
    }

    if (isBusy) {
      setError(busyMessage);
      return;
    }

    setSubmittingCsv(true);
    setError('');
    setCsvResult(null);
    setArchiveResult(null);

    try {
      const payload = await importCsv(csvSource, activeCollectionId);
      setCsvResult(payload);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSubmittingCsv(false);
    }
  }

  async function handleArchiveImport(event) {
    event.preventDefault();

    if (!archiveSource) {
      setError('Choose a .zip archive before importing.');
      return;
    }

    if (isBusy) {
      setError(busyMessage);
      return;
    }

    const confirmed = window.confirm('Importing an archive will replace collections that exist in the archive (by name). Collections missing from the archive stay untouched. Continue?');

    if (!confirmed) {
      return;
    }

    setSubmittingArchive(true);
    setError('');
    setCsvResult(null);
    setArchiveResult(null);

    try {
      await importArchive(archiveSource);
      setArchiveResult({ success: true });
      window.location.assign('/');
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSubmittingArchive(false);
    }
  }

  async function handleArchiveExport() {
    if (isBusy) {
      setError(busyMessage);
      return;
    }

    setExportingArchive(true);
    setError('');
    setArchiveResult(null);

    try {
      const payload = await downloadArchive(selectedExportCollectionIds);
      setArchiveResult({ exported: payload.filename });
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

    const confirmed = window.confirm('Delete all current app data and pictures? This cannot be undone.');

    if (!confirmed) {
      return;
    }

    setClearingData(true);
    setError('');
    setCsvResult(null);
    setArchiveResult(null);

    try {
      await clearAppData();
      window.location.assign('/');
    } catch (clearError) {
      setError(clearError.message);
    } finally {
      setClearingData(false);
    }
  }

  async function handleCreateCollection() {
    const nextName = collectionNameDraft.trim();

    if (!nextName) {
      setError('Collection name is required.');
      return;
    }

    setCollectionActionLoading(true);
    setError('');

    try {
      await onCreateCollection(nextName);
      setCollectionNameDraft('');
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setCollectionActionLoading(false);
    }
  }

  async function handleRenameCollection() {
    const nextName = collectionNameDraft.trim();

    if (!nextName || !activeCollectionId) {
      setError('Select a collection and provide a new name.');
      return;
    }

    setCollectionActionLoading(true);
    setError('');

    try {
      await onRenameCollection(activeCollectionId, nextName);
      setCollectionNameDraft('');
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setCollectionActionLoading(false);
    }
  }

  async function handleSetDefaultCollection() {
    if (!activeCollectionId) {
      return;
    }

    setCollectionActionLoading(true);
    setError('');

    try {
      await onSetDefaultCollection(activeCollectionId);
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setCollectionActionLoading(false);
    }
  }

  async function handleDeleteCollection() {
    if (!activeCollectionId) {
      return;
    }

    const confirmed = window.confirm(`Delete collection "${activeCollection?.name}" and all its notes/images?`);

    if (!confirmed) {
      return;
    }

    setCollectionActionLoading(true);
    setError('');

    try {
      await onDeleteCollection(activeCollectionId);
      setCollectionNameDraft('');
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setCollectionActionLoading(false);
    }
  }

  return (
    <section className="screen-stack narrow-stack import-screen">
      <div className="panel import-panel">
        <div className="import-panel-scroll">
          <div className="panel-heading">
          <div>
            <p className="eyebrow">Import and Export</p>
            <h1>Move your collection data</h1>
            <p>
              CSV import updates notes from spreadsheet rows. Archive export can include selected
              collections only, and archive import replaces local collections that exist in the archive
              (matched by name) while leaving other collections untouched.
            </p>
          </div>
          {showBackToTable ? (
            <Link className="button" to="/">
              Back to table
            </Link>
          ) : null}
        </div>

        <div className="collection-admin-row">
          <div className="inline-select-group">
            <span>Active collection</span>
            <select
              className="select-input"
              disabled={loadingCollections || isBusy || collectionActionLoading || !collections.length}
              onChange={(event) => onSelectCollection(Number(event.target.value))}
              value={activeCollectionId ?? ''}
            >
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {Number(collection.is_default) === 1 ? '★ ' : ''}{collection.name}
                </option>
              ))}
            </select>
          </div>
          <div className="inline-select-group">
            <input
              className="select-input"
              onChange={(event) => setCollectionNameDraft(event.target.value)}
              placeholder="Collection name"
              value={collectionNameDraft}
            />
            <button
              className="button"
              disabled={isBusy || collectionActionLoading}
              onClick={handleCreateCollection}
              type="button"
            >
              Create
            </button>
            <button
              className="button"
              disabled={isBusy || collectionActionLoading || !activeCollectionId}
              onClick={handleRenameCollection}
              type="button"
            >
              Rename
            </button>
            <button
              className="button"
              disabled={isBusy || collectionActionLoading || !activeCollectionId || Number(activeCollection?.is_default) === 1}
              onClick={handleSetDefaultCollection}
              type="button"
            >
              {Number(activeCollection?.is_default) === 1 ? 'Default' : 'Set default'}
            </button>
            <button
              className="button button-danger"
              disabled={isBusy || collectionActionLoading || !activeCollectionId}
              onClick={handleDeleteCollection}
              type="button"
            >
              Delete
            </button>
          </div>
        </div>

        {loadingCollections ? <p>Loading collections...</p> : null}
        {collectionsError ? <p className="error-text">{collectionsError}</p> : null}
        {isBusy ? <p className="warning-text">{busyMessage}</p> : null}
        <p className="warning-text">
          Archive import is destructive for collections present in the archive: local data for those collections is replaced.
        </p>

        <div className="import-sections">
          <form className="form-grid import-card" onSubmit={handleCsvSubmit}>
            <div className="full-span">
              <p className="eyebrow">CSV Import</p>
              <h2>Upload CSV into active collection</h2>
              <p>
                Existing notes in <strong>{activeCollection?.name ?? 'selected collection'}</strong> are updated in place,
                notes missing from the CSV are deleted, tags are replaced from the CSV, and rows after
                `Ignore after this line` are skipped.
              </p>
            </div>

            <div className="field-block full-span">
                <span>CSV source</span>
              <div
                className={`image-dropzone import-dropzone${csvDropActive ? ' image-dropzone--active' : ''}`}
                onClick={() => {
                  if (!isBusy) {
                    csvInputRef.current?.click();
                  }
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setCsvDropActive(true);
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget)) {
                    return;
                  }

                  setCsvDropActive(false);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setCsvDropActive(true);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setCsvDropActive(false);

                  if (isBusy) {
                    return;
                  }

                  const droppedFile = getDroppedCsvFile(event);
                  if (droppedFile) {
                    setCsvImportSource(droppedFile, droppedFile.name);
                    return;
                  }

                  const droppedText = getDroppedCsvText(event);
                  if (droppedText) {
                    setCsvImportSource(droppedText, 'Pasted CSV text');
                  }
                }}
                onPaste={(event) => {
                  if (isBusy) {
                    return;
                  }

                  const pastedFile = getPastedCsvFile(event);
                  if (pastedFile) {
                    event.preventDefault();
                    setCsvImportSource(pastedFile, pastedFile.name);
                    return;
                  }

                  const pastedText = getPastedCsvText(event);
                  if (pastedText) {
                    event.preventDefault();
                    setCsvImportSource(pastedText, 'Pasted CSV text');
                  }
                }}
                onFocus={() => setCsvDropActive(true)}
                onBlur={() => setCsvDropActive(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (!isBusy) {
                      csvInputRef.current?.click();
                    }
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="import-dropzone-content">
                  <strong>{csvSourceLabel || 'Drop CSV here or press Ctrl+V'}</strong>
                  <p className="muted import-dropzone-help">Supports `.csv` files and pasted CSV text.</p>
                </div>
              </div>
              <div className="import-actions">
                <button className="button" disabled={isBusy} onClick={() => csvInputRef.current?.click()} type="button">
                  Choose file
                </button>
                <button
                  className="button"
                  disabled={!csvSource || isBusy}
                  onClick={() => {
                    setCsvSource(null);
                    setCsvSourceLabel('');
                    if (csvInputRef.current) {
                      csvInputRef.current.value = '';
                    }
                  }}
                  type="button"
                >
                  Clear
                </button>
                <input
                  accept=".csv,text/csv"
                  className="image-slot-input"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file) {
                      setCsvImportSource(file, file.name);
                    }
                  }}
                  ref={csvInputRef}
                  type="file"
                />
              </div>
            </div>

            <button className="button button-primary import-submit" disabled={submittingCsv || isBusy || !activeCollectionId} type="submit">
              {submittingCsv ? 'Importing...' : 'Import CSV'}
            </button>
          </form>

          <form className="form-grid import-card" onSubmit={handleArchiveImport}>
            <div className="full-span">
              <p className="eyebrow">Archive Import and Export</p>
              <h2>Download or import archive data</h2>
              <p>
                Export downloads a `.zip` with `banknotes.db` and only images referenced by selected
                collections. Import always reads all collections from the archive and replaces matching
                collection names in the current data.
              </p>
              <p className="warning-text import-card-warning">
                You can also delete the current app data and start from an empty collection.
              </p>
            </div>

            <div className="field-block full-span">
              <span>Archive source</span>
              <div
                className={`image-dropzone import-dropzone${archiveDropActive ? ' image-dropzone--active' : ''}`}
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
                  if (event.key === 'Enter' || event.key === ' ') {
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
                  <strong>{archiveSource?.name || 'Drop archive here or choose a file'}</strong>
                  <p className="muted import-dropzone-help">Supports `.zip` archives exported from Note Harbor Editor.</p>
                </div>
              </div>
              <div className="import-actions">
                <button className="button" disabled={isBusy} onClick={() => archiveInputRef.current?.click()} type="button">
                  Choose archive
                </button>
                <button
                  className="button"
                  disabled={!archiveSource || isBusy}
                  onClick={() => {
                    setArchiveImportSource(null);
                    if (archiveInputRef.current) {
                      archiveInputRef.current.value = '';
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

            <div className="field-block full-span">
              <span>Collections to export</span>
              <div className="export-collection-list" role="group" aria-label="Collections to export">
                {collections.map((collection) => {
                  const collectionId = Number(collection.id);
                  const checked = selectedExportCollectionIds.includes(collectionId);

                  return (
                    <label className="export-collection-option" key={collection.id}>
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

                            return current.filter((id) => id !== collectionId);
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

            <div className="import-actions full-span">
              <button className="button" disabled={exportingArchive || isBusy || !selectedExportCollectionIds.length} onClick={handleArchiveExport} type="button">
                {exportingArchive ? 'Preparing export...' : 'Download archive'}
              </button>
              <button className="button button-primary" disabled={submittingArchive || isBusy || !archiveSource} type="submit">
                {submittingArchive ? 'Importing archive...' : 'Import archive'}
              </button>
              <button className="button button-danger" disabled={clearingData || isBusy} onClick={handleClearData} type="button">
                {clearingData ? 'Deleting data...' : 'Delete current data'}
              </button>
            </div>
          </form>
        </div>

        {error ? <p className="error-text">{error}</p> : null}

        {csvResult ? (
          <div className="result-card">
            <h2>CSV import finished</h2>
            <p>Added: {csvResult.imported}</p>
            <p>Updated: {csvResult.updated}</p>
            <p>Deleted: {csvResult.deleted}</p>
            <p>Ignored rows: {csvResult.ignored}</p>
            <p>Rows used for ordering: {csvResult.ordered}</p>
            <p>Total rows scanned: {csvResult.total}</p>
          </div>
        ) : null}

        {archiveResult?.exported ? (
          <div className="result-card">
            <h2>Archive export started</h2>
            <p>Downloaded: {archiveResult.exported}</p>
          </div>
        ) : null}
        </div>
      </div>
    </section>
  );
}

export { ImportScreen };
