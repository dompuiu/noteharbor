import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { downloadArchive, getOperationStatus, importArchive, importCsv } from '../lib/api.js';

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

function ImportScreen() {
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
  const [operationStatus, setOperationStatus] = useState({
    currentOperation: 'idle',
    isBusy: false,
    startedAt: null,
    details: null
  });

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
      const payload = await importCsv(csvSource);
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

    const confirmed = window.confirm('Importing an archive will replace the current database and pictures. Continue?');

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
      const payload = await downloadArchive();
      setArchiveResult({ exported: payload.filename });
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExportingArchive(false);
    }
  }

  return (
    <section className="screen-stack narrow-stack import-screen">
      <div className="panel import-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Import and Export</p>
            <h1>Move your collection data</h1>
            <p>
              CSV import updates notes from spreadsheet rows. Archive export downloads the full SQLite
              database and pictures, and archive import replaces the current app data with that archive.
            </p>
          </div>
          <Link className="button" to="/">
            Back to table
          </Link>
        </div>

        {isBusy ? <p className="warning-text">{busyMessage}</p> : null}
        <p className="warning-text">
          Archive import is destructive: it replaces the current database and all stored pictures.
        </p>

        <div className="import-sections">
          <form className="form-grid import-card" onSubmit={handleCsvSubmit}>
            <div className="full-span">
              <p className="eyebrow">CSV Import</p>
              <h2>Upload a collection CSV</h2>
              <p>
                Existing notes are updated in place, notes missing from the CSV are deleted, tags are
                replaced from the CSV, and rows after `Ignore after this line` are skipped.
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

            <button className="button button-primary import-submit" disabled={submittingCsv || isBusy} type="submit">
              {submittingCsv ? 'Importing...' : 'Import CSV'}
            </button>
          </form>

          <form className="form-grid import-card" onSubmit={handleArchiveImport}>
            <div className="full-span">
              <p className="eyebrow">Archive Import and Export</p>
              <h2>Download or replace full app data</h2>
              <p>
                Export downloads a `.zip` with `banknotes.db` and the `images/` folder. Importing that
                archive replaces the current app data and reloads the app state.
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
                  <p className="muted import-dropzone-help">Supports `.zip` archives exported from Notesshow.</p>
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

            <div className="import-actions full-span">
              <button className="button" disabled={exportingArchive || isBusy} onClick={handleArchiveExport} type="button">
                {exportingArchive ? 'Preparing export...' : 'Download archive'}
              </button>
              <button className="button button-primary" disabled={submittingArchive || isBusy || !archiveSource} type="submit">
                {submittingArchive ? 'Importing archive...' : 'Import archive'}
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
    </section>
  );
}

export { ImportScreen };
