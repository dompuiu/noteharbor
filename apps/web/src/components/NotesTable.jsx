import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  deleteNote,
  getNotes,
  getScrapeStatus,
  startScrape,
} from "../lib/api.js";
import { Slideshow } from "./Slideshow.jsx";

export function HomeHero() {
  return (
    <div className="hero-card hero-card--header">
      <div>
        <p className="eyebrow">Romanian Paper Money Archive</p>
        <h1 className="site-title">Notes Show</h1>

        <p className="hero-copy">
          Import your graded notes, keep the catalog tidy, enrich each entry
          with scraped imagery, and browse the collection in a dedicated
          slideshow.
        </p>
      </div>
      <div className="hero-actions">
        <Link className="button button-primary" to="/import">
          Import CSV
        </Link>
      </div>
    </div>
  );
}

const columns = [
  ["denomination", "Denomination"],
  ["issue_date", "Date"],
  ["catalog_number", "Catalog #"],
  ["grading_company", "Grading Company"],
  ["grade", "Grade"],
  ["watermark", "Watermark"],
  ["serial", "Serial"],
  ["url", "URL"],
  ["notes", "Notes"],
  ["tags", "Tags"],
  ["scrape_status", "Scrape Status"],
];

const selectCountOptions = [5, 10, 25, 50];
const tableStateStorageKey = "notesshow.notesTableState";
const validSortKeys = new Set(["id", ...columns.map(([key]) => key)]);

function loadSavedTableState() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(tableStateStorageKey);

    if (!rawValue) {
      return null;
    }

    const parsedValue = JSON.parse(rawValue);
    const nextFilters =
      parsedValue.filters && typeof parsedValue.filters === "object"
        ? Object.fromEntries(
            Object.entries(parsedValue.filters)
              .filter(([key]) =>
                columns.some(([columnKey]) => columnKey === key),
              )
              .map(([key, value]) => [key, String(value ?? "")]),
          )
        : {};
    const nextSortKey = validSortKeys.has(parsedValue.sortKey)
      ? parsedValue.sortKey
      : "id";
    const nextSortDirection =
      parsedValue.sortDirection === "desc" ? "desc" : "asc";
    const nextSelectedIds = Array.isArray(parsedValue.selectedIds)
      ? parsedValue.selectedIds.filter(
          (value) => Number.isInteger(value) && value > 0,
        )
      : [];

    return {
      filters: nextFilters,
      selectedIds: [...new Set(nextSelectedIds)],
      sortKey: nextSortKey,
      sortDirection: nextSortDirection,
    };
  } catch {
    window.localStorage.removeItem(tableStateStorageKey);
    return null;
  }
}

function statusLabel(status) {
  if (!status) {
    return "pending";
  }

  return String(status).replace(/_/g, " ");
}

function activeScrapeJob(status) {
  return status?.status === "running" ? status : null;
}

function displayScrapeStatus(note, scrapeJob) {
  if (!scrapeJob) {
    return note.scrape_status || "pending";
  }

  if (scrapeJob.currentNoteId === note.id) {
    return "running";
  }

  const item = (scrapeJob.items ?? []).find((entry) => entry.noteId === note.id);

  if (item?.status === "queued") {
    return "queued";
  }

  return note.scrape_status || "pending";
}

function valueToString(note, key) {
  if (key === "tags") {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

function pickImage(note, type, variant = "full") {
  return (
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null
  );
}

function NotesTable() {
  const initialTableStateRef = useRef(undefined);

  if (initialTableStateRef.current === undefined) {
    initialTableStateRef.current = loadSavedTableState();
  }

  const [notes, setNotes] = useState([]);
  const [filters, setFilters] = useState(
    () => initialTableStateRef.current?.filters ?? {},
  );
  const [sortKey, setSortKey] = useState(
    () => initialTableStateRef.current?.sortKey ?? "id",
  );
  const [sortDirection, setSortDirection] = useState(
    () => initialTableStateRef.current?.sortDirection ?? "asc",
  );
  const [selectedIds, setSelectedIds] = useState(
    () => initialTableStateRef.current?.selectedIds ?? [],
  );
  const [selectNextCount, setSelectNextCount] = useState(10);
  const [bulkAction, setBulkAction] = useState("scrape");
  const [scrapeJob, setScrapeJob] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
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
          setScrapeJob(activeScrapeJob(statusPayload));
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
    setSelectedIds((current) =>
      current.filter((id) => notes.some((note) => note.id === id)),
    );
  }, [notes]);

  useEffect(() => {
    if (!scrapeJob) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const [nextStatus, notesPayload] = await Promise.all([
          getScrapeStatus(),
          getNotes(),
        ]);
        const nextScrapeJob = activeScrapeJob(nextStatus);

        setNotes(notesPayload.notes);
        setScrapeJob(nextScrapeJob);
      } catch {
        // Ignore transient polling errors.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [scrapeJob]);

  const orderedNotes = useMemo(() => {
    const filtered = notes.filter((note) =>
      columns.every(([key]) => {
        const filterValue = (filters[key] ?? "").trim().toLowerCase();
        if (!filterValue) {
          return true;
        }

        return valueToString(note, key).toLowerCase().includes(filterValue);
      }),
    );

    return [...filtered].sort((left, right) => {
      const leftValue = valueToString(left, sortKey).toLowerCase();
      const rightValue = valueToString(right, sortKey).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [filters, notes, sortDirection, sortKey]);

  const allVisibleSelected = useMemo(
    () =>
      orderedNotes.length > 0 &&
      orderedNotes.every((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds],
  );
  const someVisibleSelected = useMemo(
    () => orderedNotes.some((note) => selectedIds.includes(note.id)),
    [orderedNotes, selectedIds],
  );
  const hasSavedTableState = useMemo(
    () =>
      Object.values(filters).some((value) => String(value).trim()) ||
      sortKey !== "id" ||
      sortDirection !== "asc" ||
      selectedIds.length > 0,
    [filters, selectedIds, sortDirection, sortKey],
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  useEffect(() => {
    window.localStorage.setItem(
      tableStateStorageKey,
      JSON.stringify({ filters, selectedIds, sortKey, sortDirection }),
    );
  }, [filters, selectedIds, sortDirection, sortKey]);

  function resetTableState() {
    setFilters({});
    setSortKey("id");
    setSortDirection("asc");
    setSelectedIds([]);
  }

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDirection((currentDirection) =>
        currentDirection === "asc" ? "desc" : "asc",
      );
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  }

  function openSlideshow(startId) {
    setActionError("");

    const nextIndex = startId
      ? orderedNotes.findIndex((note) => note.id === startId)
      : 0;

    setSlideshowNotes(orderedNotes);
    setSlideshowIndex(nextIndex >= 0 ? nextIndex : 0);
  }

  function closeSlideshow() {
    setSlideshowNotes([]);
    setSlideshowIndex(0);
  }

  function toggleNote(noteId) {
    setSelectedIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId],
    );
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(orderedNotes.map((note) => note.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
      return;
    }

    setSelectedIds((current) => [
      ...new Set([...current, ...orderedNotes.map((note) => note.id)]),
    ]);
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function selectNextUnscraped() {
    const nextIds = orderedNotes
      .filter((note) => note.scrape_status !== "done")
      .slice(0, selectNextCount)
      .map((note) => note.id);

    setSelectedIds(nextIds);
  }

  async function handleBulkAction() {
    if (!selectedIds.length || bulkLoading) {
      return;
    }

    setActionError("");
    setBulkLoading(true);

    try {
      if (bulkAction === "delete") {
        const shouldDelete = window.confirm(
          `Delete ${selectedIds.length} selected note${selectedIds.length === 1 ? "" : "s"}?`,
        );

        if (!shouldDelete) {
          return;
        }

        await Promise.all(selectedIds.map((id) => deleteNote(id)));
        await loadNotes();
        clearSelection();
        return;
      }

      const payload = await startScrape(selectedIds);
      setScrapeJob({
        status: "running",
        total: payload.total,
        completed: 0,
        currentNoteId: null,
        items: notes
          .filter((note) => selectedIds.includes(note.id))
          .map((note) => ({
            noteId: note.id,
            label: [note.denomination, note.catalog_number, note.serial]
              .filter(Boolean)
              .join(" - "),
            status: "queued",
            error: null,
          })),
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
      {slideshowNotes.length ? (
        <Slideshow
          currentIndex={slideshowIndex}
          notes={slideshowNotes}
          onChangeIndex={setSlideshowIndex}
          onClose={closeSlideshow}
        />
      ) : null}

      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Collection table</h2>
            <p>
              {orderedNotes.length} notes in the current view.
              {selectedIds.length ? ` ${selectedIds.length} selected.` : ""}
            </p>
          </div>
        </div>

        {loading ? <p>Loading notes...</p> : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}

        {!loading && !loadError ? (
          <>
            <div className="toolbar-row toolbar-row--table-controls">
              <div className="inline-select-group">
                <select
                  aria-label="Select next count"
                  className="select-input"
                  onChange={(event) =>
                    setSelectNextCount(Number(event.target.value))
                  }
                  value={selectNextCount}
                >
                  {selectCountOptions.map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                <button
                  className="button"
                  onClick={selectNextUnscraped}
                  type="button"
                >
                  Select next unscraped
                </button>
                <button
                  className="button"
                  disabled={!hasSavedTableState}
                  onClick={resetTableState}
                  type="button"
                >
                  Reset filters, sorting, and selection
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
                    disabled={bulkLoading || Boolean(scrapeJob)}
                    onClick={handleBulkAction}
                    type="button"
                  >
                    {bulkLoading ? "Working..." : "Apply"}
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
                    <th>ID</th>
                    <th>Front</th>
                    {columns.map(([key, label]) => (
                      <th key={key}>
                        <button
                          className="sort-button"
                          onClick={() => toggleSort(key)}
                          type="button"
                        >
                          {label}
                          {sortKey === key ? (
                            <span>{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                          ) : null}
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
                          value={filters[key] ?? ""}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          placeholder={`Filter ${label}`}
                        />
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orderedNotes.map((note) => {
                    const noteScrapeStatus = displayScrapeStatus(note, scrapeJob);
                    const frontThumb =
                      pickImage(note, "front", "thumbnail") ||
                      pickImage(note, "front", "full");
                    const frontPreview =
                      pickImage(note, "front", "full") || frontThumb;

                    return (
                      <tr
                        className="table-row-link"
                        key={note.id}
                        onClick={() => {
                          openSlideshow(note.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
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
                        <td>{note.id}</td>
                        <td>
                          {frontThumb ? (
                            <span className="table-thumb-wrap">
                              <img
                                alt={`${note.denomination} front`}
                                className="table-thumb"
                                src={frontThumb}
                              />
                              {frontPreview ? (
                                <span className="table-thumb-preview">
                                  <img
                                    alt={`${note.denomination} preview`}
                                    src={frontPreview}
                                  />
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
                            <a
                              href={note.url}
                              onClick={(event) => event.stopPropagation()}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open
                            </a>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>{note.notes}</td>
                        <td>
                          <div className="tag-list">
                            {note.tags.length ? (
                              note.tags.map((tag) => (
                                <span className="tag" key={tag.id || tag.name}>
                                  {tag.name}
                                </span>
                              ))
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`scrape-badge scrape-badge--${noteScrapeStatus}`}
                          >
                            {statusLabel(noteScrapeStatus)}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="icon-link"
                            onClick={(event) => event.stopPropagation()}
                            to={`/notes/${note.id}/edit`}
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </>
        ) : null}
      </div>
    </section>
  );
}

export { NotesTable };
