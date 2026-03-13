import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getNotes, getScrapeStatus, preparePmg, startScrape } from '../lib/api.js';

function ScrapeScreen() {
  const [notes, setNotes] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [waitSeconds, setWaitSeconds] = useState(10);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [prepMessage, setPrepMessage] = useState('');
  const [preparing, setPreparing] = useState(false);

  async function loadNotes() {
    const notesPayload = await getNotes();
    const notesWithUrl = notesPayload.notes.filter((note) => note.url);
    setNotes(notesWithUrl);
    return notesWithUrl;
  }

  useEffect(() => {
    let active = true;

    Promise.all([getNotes(), getScrapeStatus()])
      .then(([notesPayload, statusPayload]) => {
        if (!active) {
          return;
        }

        const notesWithUrl = notesPayload.notes.filter((note) => note.url);
        setNotes(notesWithUrl);
        setStatus(statusPayload);
      })
      .catch((fetchError) => {
        if (active) {
          setError(fetchError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const shouldPoll = status && (status.status === 'running' || status.pmgPreparation?.status === 'open');

    if (!shouldPoll) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextStatus = await getScrapeStatus();
        const didFinishRunning = status?.status === 'running' && nextStatus.status !== 'running';
        setStatus(nextStatus);

        if (didFinishRunning) {
          await loadNotes();
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [status]);

  const allSelected = useMemo(() => notes.length > 0 && selectedIds.length === notes.length, [notes.length, selectedIds.length]);

  function toggleNote(noteId) {
    setSelectedIds((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
    );
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : notes.map((note) => note.id));
  }

  async function handleStart() {
    setError('');

    try {
      const payload = await startScrape(selectedIds, waitSeconds);
      setStatus({
        status: 'running',
        total: payload.total,
        completed: 0,
        waitSeconds: payload.waitSeconds,
        items: notes
          .filter((note) => selectedIds.includes(note.id))
          .map((note) => ({ noteId: note.id, label: note.denomination, status: 'queued', error: null }))
      });
      setSelectedIds([]);
    } catch (startError) {
      setError(startError.message);
    }
  }

  async function handlePreparePmg() {
    setError('');
    setPrepMessage('');
    setPreparing(true);

    try {
      const firstSelectedPmgNote = notes.find(
        (note) => selectedIds.includes(note.id) && note.url?.toLowerCase().includes('pmgnotes.com')
      );
      const payload = await preparePmg(firstSelectedPmgNote?.url);

      setPrepMessage(payload.message);
      setStatus((current) =>
        current
          ? {
              ...current,
              pmgPreparation: {
                status: 'open',
                startedAt: new Date().toISOString(),
                targetUrl: payload.targetUrl,
                error: null
              }
            }
          : {
              status: 'idle',
              total: 0,
              completed: 0,
              waitSeconds,
              items: [],
              pmgPreparation: {
                status: 'open',
                startedAt: new Date().toISOString(),
                targetUrl: payload.targetUrl,
                error: null
              }
            }
      );
    } catch (prepareError) {
      setError(prepareError.message);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <section className="screen-stack">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Scraping</p>
            <h1>Collect PMG details and images</h1>
            <p>The crawler opens a visible browser window, waits for your Cloudflare interaction, then saves HTML data and images locally.</p>
          </div>
          <Link className="button" to="/">
            Back to table
          </Link>
        </div>

        {loading ? <p>Loading notes...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {!loading ? (
          <>
            <div className="toolbar-row">
              <button className="button" disabled={status?.status === 'running' || preparing} onClick={handlePreparePmg} type="button">
                {preparing ? 'Opening PMG browser...' : 'Prepare PMG browser'}
              </button>
              <button className="button" onClick={toggleAll} type="button">
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              <label className="inline-field">
                <span>Wait seconds</span>
                <input min="1" onChange={(event) => setWaitSeconds(Number(event.target.value) || 10)} type="number" value={waitSeconds} />
              </label>
              <button className="button button-primary" disabled={!selectedIds.length || status?.status === 'running'} onClick={handleStart} type="button">
                Start scraping
              </button>
            </div>

            <div className="result-card">
              <h2>Recommended PMG flow</h2>
              <p>Open the persistent PMG browser first, solve Cloudflare there, then return and start scraping with the same saved profile.</p>
              {prepMessage ? <p>{prepMessage}</p> : null}
              {status?.pmgPreparation?.status === 'open' ? <p>Preparation browser is open for <code>{status.pmgPreparation.targetUrl}</code>.</p> : null}
              {status?.pmgPreparation?.error ? <p className="error-text">{status.pmgPreparation.error}</p> : null}
            </div>

            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Denomination</th>
                    <th>Catalog #</th>
                    <th>Serial</th>
                    <th>Grading Company</th>
                    <th>Scrape Status</th>
                  </tr>
                </thead>
                <tbody>
                  {notes.map((note) => (
                    <tr key={note.id}>
                      <td>
                        <input checked={selectedIds.includes(note.id)} onChange={() => toggleNote(note.id)} type="checkbox" />
                      </td>
                      <td>{note.denomination}</td>
                      <td>{note.catalog_number}</td>
                      <td>{note.serial}</td>
                      <td>{note.grading_company}</td>
                      <td>{note.scrape_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {status ? (
              <div className="result-card">
                <h2>Job status: {status.status}</h2>
                <p>
                  Progress: {status.completed ?? 0} / {status.total ?? 0}
                </p>
                <div className="status-list">
                  {(status.items ?? []).map((item) => (
                    <div className="status-row" key={item.noteId}>
                      <strong>{item.label}</strong>
                      <span>{item.status}</span>
                      {item.error ? <span className="error-text">{item.error}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

export { ScrapeScreen };
