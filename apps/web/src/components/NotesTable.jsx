import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getNotes } from '../lib/api.js';

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
  ['tags', 'Tags']
];

function valueToString(note, key) {
  if (key === 'tags') {
    return note.tags.map((tag) => tag.name).join(', ');
  }

  return String(note[key] ?? '');
}

function NotesTable() {
  const [notes, setNotes] = useState([]);
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState('id');
  const [sortDirection, setSortDirection] = useState('asc');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    getNotes()
      .then((payload) => {
        if (active) {
          setNotes(payload.notes);
        }
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
          <Link className="button" to="/scrape">
            Scrape images
          </Link>
          <button className="button" onClick={openSlideshow} type="button" disabled={!orderedNotes.length}>
            Slideshow current view
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Collection table</h2>
            <p>{orderedNotes.length} notes in the current view.</p>
          </div>
        </div>

        {loading ? <p>Loading notes...</p> : null}
        {error ? <p className="error-text">{error}</p> : null}

        {!loading && !error ? (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
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
                {orderedNotes.map((note) => (
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
                       <Link className="icon-link" onClick={(event) => event.stopPropagation()} to={`/notes/${note.id}/edit`}>
                         Edit
                       </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export { NotesTable };
