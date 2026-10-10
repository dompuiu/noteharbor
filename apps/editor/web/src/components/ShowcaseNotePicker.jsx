import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getNotes } from "../lib/api.js";
import { matchesCatalogFamily } from "../lib/catalogFamily.js";
import { firstAvailableNoteImage } from "../lib/showcaseImages.js";

// The note picker popup (ticket 10). A filter bar over a virtualized thumbnail
// list; each row is a checkbox with the note's first available image. The
// selection accumulates across filter changes, so a user can pull notes from
// several collections into one batch. "Add selected (N)" adds and keeps the
// popup open; "Add & close" adds and closes it.
//
// Data loading: there is no global notes endpoint, so the picker fans out to
// the per-collection `GET /api/collections/:id/notes` for every collection the
// collections provider already loaded, and tags each note with its collection
// name so the cross-collection list stays legible. The fan-out is documented in
// the ticket; it is the cleanest read that needs no new endpoint.
//
// Virtualization: the list uses `@tanstack/react-virtual` (already used by the
// Notes table) with a fixed row estimate, so collections with hundreds of notes
// only mount the visible window. Thumbnails reuse `firstAvailableNoteImage`
// (front thumbnail, then front full, then back) and lazy-load.
const COLUMNS = [
  {
    value: "collection",
    label: "Collection",
    field: "collection_name",
    placeholder: "e.g. Kingdom",
  },
  {
    value: "catalog",
    label: "Catalog number",
    field: "catalog_number",
    placeholder: "e.g. 22",
  },
  {
    value: "denomination",
    label: "Denomination",
    field: "denomination",
    placeholder: "e.g. 1 leu",
  },
  {
    value: "date",
    label: "Date",
    field: "issue_date",
    placeholder: "e.g. 1917",
  },
];

function filterNotes(notes, column, value) {
  const query = value.trim();

  if (!query) {
    return notes;
  }

  if (column === "catalog") {
    return notes.filter((note) =>
      matchesCatalogFamily(note.catalog_number, query),
    );
  }

  const definition = COLUMNS.find((entry) => entry.value === column);
  const needle = query.toLowerCase();

  return notes.filter((note) =>
    String(note[definition.field] ?? "")
      .toLowerCase()
      .includes(needle),
  );
}

function noteCaption(note) {
  return [String(note.denomination ?? "").trim(), String(note.issue_date ?? "").trim()]
    .filter(Boolean)
    .join(" · ");
}

function ShowcaseNotePicker({ node, collections = [], onAdd, onClose }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [column, setColumn] = useState("catalog");
  const [value, setValue] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const filterRef = useRef(null);
  const listRef = useRef(null);

  const collectionKey = collections.map((collection) => collection.id).join(",");

  // `/` jumps to the filter field from anywhere in the popup (a checkbox, the
  // column select, a button), while typing a slash inside the field itself is
  // left alone.
  useEffect(() => {
    function handleKeyDown(event) {
      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.target === filterRef.current
      ) {
        return;
      }

      event.preventDefault();
      filterRef.current?.focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let active = true;

    if (!collections.length) {
      setNotes([]);
      setLoading(false);
      setLoadError("");
      return undefined;
    }

    setLoading(true);
    setLoadError("");

    Promise.all(
      collections.map(async (collection) => {
        const payload = await getNotes(collection.id);
        return (payload.notes ?? []).map((note) => ({
          ...note,
          collection_id: collection.id,
          collection_name: collection.name,
        }));
      }),
    )
      .then((groups) => {
        if (active) {
          setNotes(groups.flat());
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError(error.message || "Could not load notes.");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionKey]);

  // A note already in the node shows as `added` and is disabled.
  const addedIds = useMemo(
    () =>
      new Set(
        (node?.children ?? [])
          .filter((child) => child.node_type === "note")
          .map((child) => child.note_id),
      ),
    [node],
  );

  const filtered = useMemo(
    () => filterNotes(notes, column, value),
    [notes, column, value],
  );

  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    estimateSize: () => 64,
    getScrollElement: () => listRef.current,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // A new filter is a new list: jump back to the top so the window never opens
  // mid-list on stale scroll.
  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [column, value, rowVirtualizer]);

  function toggle(noteId) {
    if (addedIds.has(noteId)) {
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(noteId)) {
        next.delete(noteId);
      } else {
        next.add(noteId);
      }

      return next;
    });
  }

  // Select all adds every currently filtered row that is not already in the
  // node; Deselect all removes the currently filtered rows from the selection.
  // Neither touches picks made under another filter, so the selection
  // accumulates across filter changes.
  function selectAll() {
    setSelectedIds((current) => {
      const next = new Set(current);

      filtered.forEach((note) => {
        if (!addedIds.has(note.id)) {
          next.add(note.id);
        }
      });

      return next;
    });
  }

  function deselectAll() {
    setSelectedIds((current) => {
      const next = new Set(current);

      filtered.forEach((note) => {
        next.delete(note.id);
      });

      return next;
    });
  }

  async function add(closeAfter) {
    const ids = [...selectedIds];

    if (!ids.length || busy) {
      return;
    }

    setBusy(true);
    setAddError("");

    try {
      await onAdd(ids, notes);
      setSelectedIds(new Set());
      setBusy(false);

      if (closeAfter) {
        onClose();
      }
    } catch (error) {
      setAddError(error.message || "Could not add the notes.");
      setBusy(false);
    }
  }

  const activeColumn = COLUMNS.find((entry) => entry.value === column) ?? COLUMNS[1];
  const nodeLabel = node?.name ?? "this node";

  function renderNoteLabel(note) {
    const isAdded = addedIds.has(note.id);
    const checked = isAdded || selectedIds.has(note.id);
    const image = firstAvailableNoteImage(note);

    return (
      <label
        className={`showcase-note-row${isAdded ? " showcase-note-row--added" : ""}${selectedIds.has(note.id) ? " showcase-note-row--selected" : ""}`}
      >
        <input
          aria-label={`${noteCaption(note)} ${note.catalog_number ?? ""} ${note.collection_name ?? ""}`.trim()}
          checked={checked}
          disabled={isAdded}
          onChange={() => toggle(note.id)}
          type="checkbox"
        />
        <span aria-hidden="true" className="showcase-note-row-thumb">
          {image ? (
            <img alt="" loading="lazy" src={image.path} />
          ) : (
            <span className="showcase-note-row-thumb-empty">No image</span>
          )}
        </span>
        <span className="showcase-note-row-main">{noteCaption(note)}</span>
        <span className="showcase-note-row-pill">
          {note.catalog_number || "—"}
        </span>
        <span className="showcase-note-row-pill">{note.collection_name}</span>
        {isAdded ? (
          <span className="showcase-note-row-pill showcase-note-row-pill--added">
            added
          </span>
        ) : null}
      </label>
    );
  }

  // jsdom (and the first paint before the scroll element is measured) yields
  // no virtual rows; fall back to the plain list so the notes are still
  // visible and selectable. A measured browser always takes the virtual path.
  const useVirtualList = virtualRows.length > 0;

  return (
    <div className="showcase-picker-backdrop">
      <div
        aria-label="Add notes"
        aria-modal="true"
        className="showcase-picker"
        role="dialog"
      >
        <div className="showcase-picker-head">
          <h2 className="showcase-picker-title">Add notes to “{nodeLabel}”</h2>
          <button className="button" onClick={onClose} type="button">
            Done
          </button>
        </div>

        <div className="showcase-picker-filter">
          <select
            aria-label="Filter column"
            className="showcase-picker-column"
            onChange={(event) => setColumn(event.target.value)}
            value={column}
          >
            {COLUMNS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Filter value"
            autoFocus
            className="showcase-picker-value"
            onChange={(event) => setValue(event.target.value)}
            placeholder={activeColumn.placeholder}
            ref={filterRef}
            type="text"
            value={value}
          />
          <button className="button" onClick={selectAll} type="button">
            Select all
          </button>
          <button className="button" onClick={deselectAll} type="button">
            Deselect all
          </button>
        </div>

        <p className="showcase-picker-hint">
          {column === "catalog"
            ? "The catalog filter keeps the family rule: 22 matches 22, 22a, 22b, and 22s — never 220."
            : "The selection carries across filter changes, so you can pick notes from several collections."}
        </p>

        {!loading && !loadError ? (
          <p aria-live="polite" className="muted showcase-picker-count">
            {filtered.length === notes.length
              ? `${notes.length} notes`
              : `${filtered.length} of ${notes.length} notes`}
            {selectedIds.size ? ` · ${selectedIds.size} selected` : ""}
          </p>
        ) : null}

        <div className="showcase-picker-list" ref={listRef}>
          {loading ? (
            <p className="muted showcase-picker-empty">Loading notes…</p>
          ) : null}

          {!loading && loadError ? (
            <p className="showcase-error" role="alert">
              {loadError}
            </p>
          ) : null}

          {!loading && !loadError && filtered.length === 0 ? (
            <p className="muted showcase-picker-empty">No notes match.</p>
          ) : null}

          {!loading && !loadError && filtered.length > 0 ? (
            useVirtualList ? (
              <div
                className="showcase-picker-virtual"
                style={{ height: `${totalSize}px` }}
              >
                {virtualRows.map((virtualRow) => {
                  const note = filtered[virtualRow.index];

                  if (!note) {
                    return null;
                  }

                  return (
                    <div
                      className="showcase-picker-virtual-row"
                      data-index={virtualRow.index}
                      key={note.id}
                      ref={(element) => {
                        if (element) {
                          rowVirtualizer.measureElement(element);
                        }
                      }}
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {renderNoteLabel(note)}
                    </div>
                  );
                })}
              </div>
            ) : (
              filtered.map((note) => (
                <div key={note.id}>{renderNoteLabel(note)}</div>
              ))
            )
          ) : null}
        </div>

        <div className="showcase-picker-actions">
          <button
            className="button"
            disabled={!selectedIds.size || busy}
            onClick={() => add(false)}
            type="button"
          >
            Add selected ({selectedIds.size})
          </button>
          <button
            className="button button-primary"
            disabled={!selectedIds.size || busy}
            onClick={() => add(true)}
            type="button"
          >
            Add &amp; close
          </button>

          {addError ? (
            <p className="showcase-error" role="alert">
              {addError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { ShowcaseNotePicker };
