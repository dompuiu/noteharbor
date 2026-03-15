import { useState } from 'react';
import { Link } from 'react-router-dom';
import { importCsv } from '../lib/api.js';

function ImportScreen() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!file) {
      setError('Choose a CSV file before importing.');
      return;
    }

    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const payload = await importCsv(file);
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
            <p>The importer skips empty separators, ignores non-banknote rows, adds missing notes, and syncs the table order to match the CSV.</p>
          </div>
          <Link className="button" to="/">
            Back to table
          </Link>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field-block">
            <span>CSV file</span>
            <input accept=".csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" />
          </label>
          <button className="button button-primary import-submit" disabled={submitting} type="submit">
            {submitting ? 'Importing...' : 'Import file'}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}

        {result ? (
          <div className="result-card">
            <h2>Import finished</h2>
            <p>Imported: {result.imported}</p>
            <p>Duplicates skipped: {result.skipped}</p>
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
