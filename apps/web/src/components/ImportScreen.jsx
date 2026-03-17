import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { importCsv } from '../lib/api.js';

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

function ImportScreen() {
  const navigate = useNavigate();
  const [source, setSource] = useState(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef(null);

  function setCsvSource(nextSource, label) {
    setSource(nextSource);
    setSourceLabel(label);
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

  async function handleSubmit(event) {
    event.preventDefault();

    if (!source) {
      setError('Choose, drop, or paste a CSV before importing.');
      return;
    }

    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const payload = await importCsv(source);
      setResult(payload);
    } catch (importError) {
      setError(importError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="screen-stack narrow-stack import-screen">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Import</p>
            <h1>Upload a collection CSV</h1>
            <p>
              Drop a CSV, paste it with Ctrl+V, or choose a file. Existing notes are updated in place,
              notes missing from the CSV are deleted, tags are replaced from the CSV, and rows after
              `Ignore after this line` are skipped.
            </p>
          </div>
          <Link className="button" to="/">
            Back to table
          </Link>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <div className="field-block full-span">
            <span>CSV source</span>
            <div
              className={`image-dropzone import-dropzone${dropActive ? ' image-dropzone--active' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget)) {
                  return;
                }

                setDropActive(false);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDropActive(true);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setDropActive(false);

                const droppedFile = getDroppedCsvFile(event);
                if (droppedFile) {
                  setCsvSource(droppedFile, droppedFile.name);
                  return;
                }

                const droppedText = getDroppedCsvText(event);
                if (droppedText) {
                  setCsvSource(droppedText, 'Pasted CSV text');
                }
              }}
              onPaste={(event) => {
                const pastedFile = getPastedCsvFile(event);
                if (pastedFile) {
                  event.preventDefault();
                  setCsvSource(pastedFile, pastedFile.name);
                  return;
                }

                const pastedText = getPastedCsvText(event);
                if (pastedText) {
                  event.preventDefault();
                  setCsvSource(pastedText, 'Pasted CSV text');
                }
              }}
              onFocus={() => setDropActive(true)}
              onBlur={() => setDropActive(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="import-dropzone-content">
                <strong>{sourceLabel || 'Drop CSV here or press Ctrl+V'}</strong>
                <p className="muted import-dropzone-help">
                  Supports `.csv` files and pasted CSV text.
                </p>
              </div>
            </div>
            <div className="import-actions">
              <button className="button" onClick={() => inputRef.current?.click()} type="button">
                Choose file
              </button>
              <button
                className="button"
                disabled={!source}
                onClick={() => {
                  setSource(null);
                  setSourceLabel('');
                  if (inputRef.current) {
                    inputRef.current.value = '';
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
                    setCsvSource(file, file.name);
                  }
                }}
                ref={inputRef}
                type="file"
              />
            </div>
          </div>

          <button className="button button-primary import-submit" disabled={submitting} type="submit">
            {submitting ? 'Importing...' : 'Import CSV'}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}

        {result ? (
          <div className="result-card">
            <h2>Import finished</h2>
            <p>Added: {result.imported}</p>
            <p>Updated: {result.updated}</p>
            <p>Deleted: {result.deleted}</p>
            <p>Ignored rows: {result.ignored}</p>
            <p>Rows used for ordering: {result.ordered}</p>
            <p>Total rows scanned: {result.total}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export { ImportScreen };
