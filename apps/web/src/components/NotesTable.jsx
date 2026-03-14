import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteNote, getNotes, getScrapeStatus, startScrape } from '../lib/api.js';

const columns = [
  ['denomination', 'Denomination'],
  ['issue_date', 'Date'],
  ['catalog_number', 'Catalog #'],
  ['grading_company', 'Grading Company'],
  ['grade', 'Grade'],
  ['watermark', 'Watermark'],
  ['serial', 'Serial'],
  ['url', 'URL'],
  ['notes', 'Notes'],
  ['tags', 'Tags'],
  ['scrape_status', 'Scrape Status']
];

const selectCountOptions = [5, 10, 25, 50];

function statusLabel(status) {
  if (!status) {
    return 'pending';
  }

  return String(status).replace(/_/g, ' ');
}

function valueToString(note, key) {
  if (key === 'tags') {
    return note.tags.map((tag) => tag.name).join(', ');
  }

  return String(note[key] ?? '');
}

function pickImage(note, type, variant = 'full') {
  return note.images.find((image) => image.type === type && image.variant === variant)?.localPath ?? null;
}

function NotesTable() {
  const [notes, setNotes] = useState([]);
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState('id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectNextCount, setSelectNextCount] = useState(10);
  const [bulkAction, setBulkAction] = useState('scrape');
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const navigate = useNavigate();
  const selectAllRef = useRef(null);

  async function loadNotes() {
    const payload = await getNotes();
    setNotes(payload.notes);
    return payload.notes;
  }

  useEffect(() => {
    let active = true;

    Promise.all([getNotes(), getScrapeStatus()])
      .then(([notesPayload, statusPayload]) => {
        if (active) {
          setNotes(notesPayload.notes);
          setStatus(statusPayload);
        }
      })
      .catch((fetchError) => {
        if (active) {
          setLoadError(fetchError.message);
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
    setSelectedIds((current) => current.filter((id) => notes.some((note) => note.id === id)));
  }, [notes]);

  useEffect(() => {
    const shouldPoll = status && status.status === 'running';

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

  const orderedNotes = useMemo(() => {
    const filtered = notes.filter((note) =>
      columns.every(([key]) => {
        const filterValue = (filters[key] ?? '').trim().toLowerCase();
        if (!filterValue) {
          return true;
        }

        return valueToString(note, key).toLowerCase().includes(filterValue);
      })
    );

    return [...filtered].sort((left, right) => {
      const leftValue = valueToString(left, sortKey).toLowerCase();
      const rightValue = valueToString(right, sortKey).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' });
      return sortDirection === 'asc' ? result : -result;
    });
  }, [filters, notes, sortDirection, sortKey]);

  const allVisibleSelected = useMemo(
    () => orderedNotes.length > 0 && orderedNotes.every((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds]
  );
  const someVisibleSelected = useMemo(
    () => orderedNotes.some((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds]
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortKey(key);
    setSortDirection('asc');
  }

  function openSlideshow(startId) {
    const ids = orderedNotes.map((note) => note.id).join(',');
    const searchParams = new URLSearchParams({ ids });

    if (startId) {
      searchParams.set('start', String(startId));
    }

    navigate(`/slideshow?${searchParams.toString()}`);
  }

  function toggleNote(noteId) {
    setSelectedIds((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
    );
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(orderedNotes.map((note) => note.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedIds((current) => [...new Set([...current, ...orderedNotes.map((note) => note.id)])]);
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function selectNextUnscraped() {
    const nextIds = orderedNotes
      .filter((note) => note.scrape_status !== 'done')
      .slice(0, selectNextCount)
      .map((note) => note.id);

    setSelectedIds(nextIds);
  }

  async function handleBulkAction() {
    if (!selectedIds.length || bulkLoading) {
      return;
    }

    setActionError('');
    setBulkLoading(true);

    try {
      if (bulkAction === 'delete') {
        const shouldDelete = window.confirm(`Delete ${selectedIds.length} selected note${selectedIds.length === 1 ? '' : 's'}?`);

        if (!shouldDelete) {
          return;
        }

        await Promise.all(selectedIds.map((id) => deleteNote(id)));
        await loadNotes();
        setStatus((current) => (current?.status === 'running' ? current : null));
        clearSelection();
        return;
      }

      const payload = await startScrape(selectedIds);
      setStatus({
        status: 'running',
        total: payload.total,
        completed: 0,
        items: notes
          .filter((note) => selectedIds.includes(note.id))
          .map((note) => ({
            noteId: note.id,
            label: [note.denomination, note.catalog_number, note.serial].filter(Boolean).join(' - '),
            status: 'queued',
            error: null
          }))
      });
      clearSelection();
    } catch (actionError) {
      setActionError(actionError.message);
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <section className="screen-stack">
      <div className="hero-card">
        <div>
          <p className="eyebrow">Romanian Paper Money Archive</p>
          <h1>Banknotes collection</h1>
          <p className="hero-copy">
            Import your graded notes, keep the catalog tidy, enrich each entry with scraped imagery, and browse the collection in a
            dedicated slideshow.
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button button-primary" to="/import">
            Import CSV
          </Link>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Collection table</h2>
            <p>
              {orderedNotes.length} notes in the current view.
              {selectedIds.length ? ` ${selectedIds.length} selected.` : ''}
            </p>
          </div>
        </div>

        {loading ? <p>Loading notes...</p> : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}

        {!loading && !loadError ? (
          <>
            <div className="toolbar-row toolbar-row--table-controls">
              <button className="button" onClick={toggleAllVisible} type="button">
                Select all
              </button>
              <button className="button" disabled={!selectedIds.length} onClick={clearSelection} type="button">
                Deselect all
              </button>
              <div className="inline-select-group">
                <select
                  aria-label="Select next count"
                  className="select-input"
                  onChange={(event) => setSelectNextCount(Number(event.target.value))}
                  value={selectNextCount}
                >
                  {selectCountOptions.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                <button className="button" onClick={selectNextUnscraped} type="button">
                  Select next unscraped
                </button>
              </div>
              {selectedIds.length ? (
                <div className="inline-select-group inline-select-group--bulk">
                  <select
                    aria-label="Bulk action"
                    className="select-input"
                    onChange={(event) => setBulkAction(event.target.value)}
                    value={bulkAction}
                  >
                    <option value="scrape">Scrape selected</option>
                    <option value="delete">Delete selected</option>
                  </select>
                  <button
                    className="button button-primary"
                    disabled={bulkLoading || status?.status === 'running'}
                    onClick={handleBulkAction}
                    type="button"
                  >
                    {bulkLoading ? 'Working...' : 'Apply'}
                  </button>
                </div>
              ) : null}
            </div>

            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        aria-label="Select all visible rows"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        ref={selectAllRef}
                        type="checkbox"
                      />
                    </th>
                    <th>#</th>
                    <th>Front</th>
                    {columns.map(([key, label]) => (
                      <th key={key}>
                        <button className="sort-button" onClick={() => toggleSort(key)} type="button">
                          {label}
                          {sortKey === key ? <span>{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span> : null}
                        </button>
                      </th>
                    ))}
                    <th>Actions</th>
                  </tr>
                  <tr>
                    <th />
                    <th />
                    <th />
                    {columns.map(([key, label]) => (
                      <th key={`${key}-filter`}>
                        <input
                          aria-label={`Filter ${label}`}
                          className="filter-input"
                          value={filters[key] ?? ''}
                          onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
                          placeholder={`Filter ${label}`}
                        />
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orderedNotes.map((note, index) => {
                    const frontThumb = pickImage(note, 'front', 'thumbnail') || pickImage(note, 'front', 'full');
                    const frontPreview = pickImage(note, 'front', 'full') || frontThumb;

                    return (
                      <tr
                        className="table-row-link"
                        key={note.id}
                        onClick={() => openSlideshow(note.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openSlideshow(note.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <td onClick={(event) => event.stopPropagation()}>
                          <input
                            aria-label={`Select ${note.denomination}`}
                            checked={selectedIds.includes(note.id)}
                            onChange={() => toggleNote(note.id)}
                            type="checkbox"
                          />
                        </td>
                        <td>{index + 1}</td>
                        <td>
                          {frontThumb ? (
                            <span className="table-thumb-wrap">
                              <img alt={`${note.denomination} front`} className="table-thumb" src={frontThumb} />
                              {frontPreview ? (
                                <span className="table-thumb-preview">
                                  <img alt={`${note.denomination} preview`} src={frontPreview} />
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>{note.denomination}</td>
                        <td>{note.issue_date}</td>
                        <td>{note.catalog_number}</td>
                        <td>{note.grading_company}</td>
                        <td>{note.grade}</td>
                        <td>{note.watermark}</td>
                        <td>{note.serial}</td>
                        <td>
                          {note.url ? (
                            <a href={note.url} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
                              Open
                            </a>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>{note.notes}</td>
                        <td>
                          <div className="tag-list">
                            {note.tags.length ? note.tags.map((tag) => <span className="tag" key={tag.id || tag.name}>{tag.name}</span>) : <span className="muted">-</span>}
                          </div>
                        </td>
                        <td>
                          <span className={`scrape-badge scrape-badge--${note.scrape_status || 'pending'}`}>
                            {statusLabel(note.scrape_status)}
                          </span>
                        </td>
                        <td>
                          <Link className="icon-link" onClick={(event) => event.stopPropagation()} to={`/notes/${note.id}/edit`}>
                            Edit
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
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
                      <span className={`scrape-badge scrape-badge--${item.status || 'pending'}`}>{statusLabel(item.status)}</span>
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

export { NotesTable };
