import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link } from "react-router-dom";
import {
  deleteNote,
  getNotes,
  reorderNotes as saveNotesOrder,
  getScrapeStatus,
  startScrape,
} from "../lib/api.js";
import { isScrapingDisabled } from "../lib/appMode.js";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { Slideshow } from "./Slideshow.jsx";

export function HomeHero() {
  return null;
}

const baseColumns = [
  ["denomination", "Denomination"],
  ["issue_date", "Date"],
  ["catalog_number", "Catalog #"],
  ["grading_company", "Company"],
  ["grade", "Grade"],
  ["serial", "Serial"],
  ["tags", "Tags"],
];
const scrapeStatusColumn = ["scrape_status", "Scraped"];
const columns = [
  ...baseColumns,
  ["scrape_status", "Scraped"],
];

const selectCountOptions = [5, 10, 25, 50];
const tableStateStorageKey = "notesshow.notesTableState";
const validSortKeys = new Set(["id", ...columns.map(([key]) => key)]);
const rowHeightEstimate = 43;

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
      nextSortKey === "id"
        ? "asc"
        : parsedValue.sortDirection === "desc"
          ? "desc"
          : "asc";
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

function statusIcon(status) {
  switch (status) {
    case "done":
      return "✓";
    case "failed":
      return "✕";
    case "running":
      return "↻";
    case "queued":
      return "…";
    case "pending":
    case "idle":
    default:
      return "○";
  }
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

  const item = (scrapeJob.items ?? []).find(
    (entry) => entry.noteId === note.id,
  );

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
  const rowElementMapRef = useRef(new Map());
  const dragPreviewRef = useRef(null);
  const tableShellRef = useRef(null);
  const tagsFilterInputRef = useRef(null);
  const shouldCloseEditorOverlayRef = useRef(false);

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
  const [bulkAction, setBulkAction] = useState(
    isScrapingDisabled ? "delete" : "scrape",
  );
  const [scrapeJob, setScrapeJob] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [creatingNote, setCreatingNote] = useState(false);
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const selectAllRef = useRef(null);
  const showSelection = true;
  const showReorder = true;
  const showActions = true;
  const visibleColumns = useMemo(
    () => (isScrapingDisabled ? baseColumns : [...baseColumns, scrapeStatusColumn]),
    [],
  );
  const showScrapeStatusColumn = visibleColumns.some(
    ([key]) => key === "scrape_status",
  );
  const totalColumnCount =
    visibleColumns.length +
    2 +
    (showSelection ? 1 : 0) +
    (showReorder ? 1 : 0) +
    (showActions ? 1 : 0);

  async function loadNotes() {
    const payload = await getNotes();
    setNotes(payload.notes);
    return payload.notes;
  }

  useEffect(() => {
    let active = true;

    const initialLoad = isScrapingDisabled
      ? getNotes().then((notesPayload) => {
          if (active) {
            setNotes(notesPayload.notes);
            setScrapeJob(null);
          }
        })
      : Promise.all([getNotes(), getScrapeStatus()]).then(
          ([notesPayload, statusPayload]) => {
            if (active) {
              setNotes(notesPayload.notes);
              setScrapeJob(activeScrapeJob(statusPayload));
            }
          },
        );

    initialLoad
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
    if (isScrapingDisabled || !scrapeJob) {
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

  useEffect(() => {
    if (!editingNoteId && !creatingNote) {
      return undefined;
    }

    function handleKeyDown(event) {
        if (event.key === "Escape") {
          setEditingNoteId(null);
          setCreatingNote(false);
        }
      }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [creatingNote, editingNoteId]);

  const orderedNotes = useMemo(() => {
    const filtered = notes.filter((note) =>
      visibleColumns.every(([key]) => {
        const filterValue = (filters[key] ?? "").trim().toLowerCase();
        if (!filterValue) {
          return true;
        }

        return valueToString(note, key).toLowerCase().includes(filterValue);
      }),
    );

    if (sortKey === "id") {
      return filtered;
    }

    return [...filtered].sort((left, right) => {
      const leftValue = valueToString(left, sortKey).toLowerCase();
      const rightValue = valueToString(right, sortKey).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [filters, notes, sortDirection, sortKey, visibleColumns]);
  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((value) => String(value).trim()),
    [filters],
  );
  const isDefaultOrder = sortKey === "id" && sortDirection === "asc";
  const canReorder =
    showReorder && !hasActiveFilters && isDefaultOrder && !reorderLoading;

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
      hasActiveFilters ||
      sortKey !== "id" ||
      sortDirection !== "asc" ||
      selectedIds.length > 0,
    [hasActiveFilters, selectedIds, sortDirection, sortKey],
  );
  const rowVirtualizer = useVirtualizer({
    count: orderedNotes.length,
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => tableShellRef.current,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

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

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [filters, rowVirtualizer, sortDirection, sortKey]);

  function resetTableState() {
    setFilters({});
    setSortKey("id");
    setSortDirection("asc");
    if (showSelection) {
      setSelectedIds([]);
    }
  }

  function applyTagFilter(tagName) {
    setFilters((current) => ({
      ...current,
      tags: tagName,
    }));

    window.requestAnimationFrame(() => {
      tagsFilterInputRef.current?.focus();
      tagsFilterInputRef.current?.select();
    });
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

  function openEditor(noteId) {
    setActionError("");
    setCreatingNote(false);
    setEditingNoteId(noteId);
  }

  function openCreateNote() {
    setActionError("");
    setEditingNoteId(null);
    setCreatingNote(true);
  }

  function closeEditor() {
    setEditingNoteId(null);
    setCreatingNote(false);
  }

  function handleEditorOverlayMouseDown(event) {
    shouldCloseEditorOverlayRef.current =
      event.button === 0 && event.target === event.currentTarget;
  }

  function handleEditorOverlayClick(event) {
    const shouldClose =
      shouldCloseEditorOverlayRef.current &&
      event.button === 0 &&
      event.target === event.currentTarget;

    shouldCloseEditorOverlayRef.current = false;

    if (shouldClose) {
      closeEditor();
    }
  }

  function handleSaveEditedNote(updatedNote) {
    setNotes((current) => {
      const noteExists = current.some((note) => note.id === updatedNote.id);

      if (noteExists) {
        return current.map((note) =>
          note.id === updatedNote.id ? updatedNote : note,
        );
      }

      return [...current, updatedNote];
    });

    setSlideshowNotes((current) => {
      if (!current.length) {
        return current;
      }

      const noteExists = current.some((note) => note.id === updatedNote.id);

      if (!noteExists) {
        return current;
      }

      return current.map((note) =>
        note.id === updatedNote.id ? updatedNote : note,
      );
    });

    closeEditor();
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

  function clearDragPreview() {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  }

  function clearDragState() {
    clearDragPreview();
    setDraggedNoteId(null);
    setDropTarget(null);
  }

  function autoScrollTableShell(event) {
    const shell = tableShellRef.current;

    if (!shell || draggedNoteId === null) {
      return;
    }

    const bounds = shell.getBoundingClientRect();
    const threshold = 56;
    const maxStep = 24;

    if (event.clientY < bounds.top + threshold) {
      const ratio = (bounds.top + threshold - event.clientY) / threshold;
      shell.scrollTop -= Math.ceil(maxStep * Math.min(1, ratio));
    } else if (event.clientY > bounds.bottom - threshold) {
      const ratio = (event.clientY - (bounds.bottom - threshold)) / threshold;
      shell.scrollTop += Math.ceil(maxStep * Math.min(1, ratio));
    }
  }

  function updateDropTarget(noteId, event) {
    const row = rowElementMapRef.current.get(noteId);

    if (!row) {
      return;
    }

    const bounds = row.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";

    setDropTarget((current) =>
      current?.noteId === noteId && current?.placement === placement
        ? current
        : { noteId, placement },
    );
  }

  async function handleReorder(targetNoteId, placement) {
    if (!canReorder || draggedNoteId === null) {
      clearDragState();
      return;
    }

    const startIndex = notes.findIndex((note) => note.id === draggedNoteId);
    const targetIndex = notes.findIndex((note) => note.id === targetNoteId);

    if (startIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
      clearDragState();
      return;
    }

    const previousNotes = notes;
    const nextNotes = [...notes];
    const [movedNote] = nextNotes.splice(startIndex, 1);
    const insertIndex =
      startIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
    nextNotes.splice(insertIndex, 0, movedNote);

    const reorderedNotes = nextNotes.map((note, index) => ({
      ...note,
      display_order: index + 1,
    }));

    setActionError("");
    setNotes(reorderedNotes);
    setReorderLoading(true);
    clearDragState();

    try {
      const payload = await saveNotesOrder(
        reorderedNotes.map((note) => note.id),
      );
      setNotes(payload.notes);
    } catch (reorderError) {
      setActionError(reorderError.message);
      setNotes(previousNotes);
    } finally {
      setReorderLoading(false);
    }
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

      if (isScrapingDisabled) {
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

  async function handleDeleteNote(noteId) {
    const note = notes.find((entry) => entry.id === noteId);
    const noteLabel = note?.denomination || `note #${noteId}`;
    const shouldDelete = window.confirm(`Delete ${noteLabel}?`);

    if (!shouldDelete) {
      return;
    }

    setActionError("");

    try {
      await deleteNote(noteId);
      setNotes((current) => current.filter((entry) => entry.id !== noteId));
      setSelectedIds((current) => current.filter((id) => id !== noteId));
    } catch (deleteError) {
      setActionError(deleteError.message);
    }
  }

  return (
    <section className="screen-stack">
      {slideshowNotes.length ? (
        <Slideshow
          currentIndex={slideshowIndex}
          keyboardDisabled={Boolean(editingNoteId || creatingNote)}
          notes={slideshowNotes}
          onChangeIndex={setSlideshowIndex}
          onClose={closeSlideshow}
          onEdit={openEditor}
        />
      ) : null}

      {editingNoteId || creatingNote ? (
        <section
          className="edit-note-overlay"
          onClick={handleEditorOverlayClick}
          onMouseDown={handleEditorOverlayMouseDown}
        >
          <div
            className="edit-note-overlay-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <NoteEditForm
              cancelLabel="Close"
              noteId={editingNoteId}
              onCancel={closeEditor}
              onSaveSuccess={handleSaveEditedNote}
              overlay
            />
          </div>
        </section>
      ) : null}

      <div className="panel">
            <div className="panel-heading panel-heading--compact">
            <div className="panel-heading-copy">
              <p className="eyebrow">Romanian Paper Money Archive</p>
              <h2>Notes Show</h2>
            <p>
              {orderedNotes.length} notes in the current view.
              {showSelection && selectedIds.length
                ? ` ${selectedIds.length} selected.`
                : ""}
            </p>
            </div>
            <div className="inline-actions">
              <button
                className="button button-primary"
                onClick={openCreateNote}
                type="button"
              >
                Add banknote
              </button>
              <Link className="button" to="/import">
                Import CSV
              </Link>
            </div>
          </div>

        {loading ? <p>Loading notes...</p> : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}

        {!loading && !loadError ? (
          <>
            <div className="toolbar-row toolbar-row--table-controls">
              <div className="inline-select-group">
                {hasSavedTableState ? (
                  <button
                    className="button"
                    onClick={resetTableState}
                    type="button"
                  >
                    Reset filters, sorting, and selection
                  </button>
                ) : null}
                {!isScrapingDisabled ? (
                  <>
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
                  </>
                ) : null}
              </div>
              <p className="table-helper-text">
                {reorderLoading
                  ? "Saving manual order..."
                  : canReorder
                    ? "Drag rows from the handle to change the default order."
                    : "Reordering is available only in the default unfiltered view."}
              </p>
              {selectedIds.length ? (
                <div className="inline-select-group inline-select-group--bulk">
                  <select
                    aria-label="Bulk action"
                    className="select-input"
                    onChange={(event) => setBulkAction(event.target.value)}
                    value={bulkAction}
                  >
                    {!isScrapingDisabled ? (
                      <option value="scrape">Scrape selected</option>
                    ) : null}
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

            <div
              className="table-shell"
              onDragOver={autoScrollTableShell}
              ref={tableShellRef}
            >
              <table>
                <thead>
                  <tr>
                    {showReorder ? <th className="drag-cell" /> : null}
                    {showSelection ? (
                      <th>
                        <input
                          aria-label="Select all visible rows"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                          ref={selectAllRef}
                          type="checkbox"
                        />
                      </th>
                    ) : null}
                    <th>ID</th>
                    <th>Front</th>
                    {visibleColumns.map(([key, label]) => (
                      <th
                        className={
                          key === "scrape_status" ? "scrape-status-column" : undefined
                        }
                        key={key}
                      >
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
                    {showActions ? <th>Actions</th> : null}
                  </tr>
                  <tr>
                    {showReorder ? <th className="drag-cell" /> : null}
                    {showSelection ? <th /> : null}
                    <th />
                    <th />
                    {visibleColumns.map(([key, label]) => (
                      <th
                        className={
                          key === "scrape_status" ? "scrape-status-column" : undefined
                        }
                        key={`${key}-filter`}
                      >
                        <input
                          aria-label={`Filter ${label}`}
                          className="filter-input"
                          ref={key === "tags" ? tagsFilterInputRef : undefined}
                          value={filters[key] ?? ""}
                          onChange={(event) =>
                            setFilters((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                        />
                      </th>
                    ))}
                    {showActions ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {topSpacerHeight ? (
                    <tr aria-hidden="true" className="table-spacer-row">
                      <td colSpan={totalColumnCount} style={{ height: topSpacerHeight }} />
                    </tr>
                  ) : null}
                  {virtualRows.map((virtualRow) => {
                    const note = orderedNotes[virtualRow.index];
                    const noteScrapeStatus = displayScrapeStatus(
                      note,
                      scrapeJob,
                    );
                    const frontThumb =
                      pickImage(note, "front", "thumbnail") ||
                      pickImage(note, "front", "full");
                    const frontPreview =
                      pickImage(note, "front", "full") || frontThumb;
                    const showPlaceholderBefore =
                      dropTarget?.noteId === note.id &&
                      dropTarget.placement === "before";
                    const showPlaceholderAfter =
                      dropTarget?.noteId === note.id &&
                      dropTarget.placement === "after";

                    return (
                      <Fragment key={note.id}>
                        {showPlaceholderBefore ? (
                          <tr
                            className="table-drop-placeholder-row"
                            aria-hidden="true"
                          >
                            <td
                              className="table-drop-placeholder-cell"
                              colSpan={totalColumnCount}
                            >
                              <span className="table-drop-placeholder-line" />
                            </td>
                          </tr>
                        ) : null}
                        <tr
                          className={`table-row-link${draggedNoteId === note.id ? " table-row-link--dragging" : ""}`}
                          data-index={virtualRow.index}
                          key={note.id}
                          ref={(element) => {
                            if (element) {
                              rowElementMapRef.current.set(note.id, element);
                              rowVirtualizer.measureElement(element);
                            } else {
                              rowElementMapRef.current.delete(note.id);
                            }
                          }}
                          onDragLeave={(event) => {
                            if (
                              !event.currentTarget.contains(event.relatedTarget)
                            ) {
                              setDropTarget((current) =>
                                current?.noteId === note.id ? null : current,
                              );
                            }
                          }}
                          onDragOver={(event) => {
                            if (!canReorder || draggedNoteId === null) {
                              return;
                            }

                            event.preventDefault();
                            updateDropTarget(note.id, event);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const nextPlacement =
                              dropTarget?.noteId === note.id
                                ? dropTarget.placement
                                : event.clientY <
                                    event.currentTarget.getBoundingClientRect()
                                      .top +
                                      event.currentTarget.getBoundingClientRect()
                                        .height /
                                        2
                                  ? "before"
                                  : "after";
                            void handleReorder(note.id, nextPlacement);
                          }}
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
                          {showReorder ? (
                            <td
                              className={`drag-cell${canReorder ? " drag-cell--enabled" : ""}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {canReorder ? (
                                <button
                                  aria-label={`Move ${note.denomination}`}
                                  className="drag-handle"
                                  draggable={canReorder}
                                  onClick={(event) => event.stopPropagation()}
                                  onDragEnd={clearDragState}
                                  onDragStart={(event) => {
                                    const row = rowElementMapRef.current.get(
                                      note.id,
                                    );

                                    clearDragPreview();
                                    event.stopPropagation();
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "text/plain",
                                      String(note.id),
                                    );

                                    if (row) {
                                      const preview = row.cloneNode(true);
                                      preview.classList.add("table-drag-preview");
                                      preview.style.width = `${row.getBoundingClientRect().width}px`;
                                      document.body.appendChild(preview);
                                      dragPreviewRef.current = preview;
                                      event.dataTransfer.setDragImage(
                                        preview,
                                        24,
                                        24,
                                      );
                                    }

                                    setDraggedNoteId(note.id);
                                    setDropTarget({
                                      noteId: note.id,
                                      placement: "before",
                                    });
                                  }}
                                  type="button"
                                >
                                  <span
                                    className="drag-handle-dots"
                                    aria-hidden="true"
                                  >
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                          {showSelection ? (
                            <td onClick={(event) => event.stopPropagation()}>
                              <input
                                aria-label={`Select ${note.denomination}`}
                                checked={selectedIds.includes(note.id)}
                                onChange={() => toggleNote(note.id)}
                                type="checkbox"
                              />
                            </td>
                          ) : null}
                          <td>{note.display_order ?? "-"}</td>
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
                          <td>
                            {note.url ? (
                              <a
                                href={note.url}
                                onClick={(event) => event.stopPropagation()}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {note.denomination}
                              </a>
                            ) : (
                              note.denomination
                            )}
                          </td>
                          <td>{note.issue_date}</td>
                          <td>{note.catalog_number}</td>
                          <td>{note.grading_company}</td>
                          <td>{note.grade}</td>
                          <td>{note.serial}</td>
                          <td>
                            <div className="tag-list">
                              {note.tags.length ? (
                                note.tags.map((tag) => (
                                  <button
                                    className="tag"
                                    key={tag.id || tag.name}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      applyTagFilter(tag.name);
                                    }}
                                    type="button"
                                  >
                                    {tag.name}
                                  </button>
                                ))
                              ) : (
                                <span className="muted">-</span>
                              )}
                            </div>
                          </td>
                          {showScrapeStatusColumn ? (
                            <td className="scrape-status-column">
                              <span
                                aria-label={statusLabel(noteScrapeStatus)}
                                className={`scrape-badge scrape-badge--${noteScrapeStatus}`}
                                role="img"
                                title={statusLabel(noteScrapeStatus)}
                              >
                                {statusIcon(noteScrapeStatus)}
                              </span>
                            </td>
                          ) : null}
                          {showActions ? (
                            <td>
                              <div className="inline-actions">
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditor(note.id);
                                  }}
                                  type="button"
                                >
                                  Edit
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteNote(note.id);
                                  }}
                                  type="button"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                        {showPlaceholderAfter ? (
                          <tr
                            className="table-drop-placeholder-row"
                            aria-hidden="true"
                          >
                            <td
                              className="table-drop-placeholder-cell"
                              colSpan={totalColumnCount}
                            >
                              <span className="table-drop-placeholder-line" />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {bottomSpacerHeight ? (
                    <tr aria-hidden="true" className="table-spacer-row">
                      <td colSpan={totalColumnCount} style={{ height: bottomSpacerHeight }} />
                    </tr>
                  ) : null}
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
