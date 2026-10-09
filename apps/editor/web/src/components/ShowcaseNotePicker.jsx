import { useEffect, useMemo, useState } from "react";
import { getNotes } from "../lib/api.js";
import { matchesCatalogFamily } from "../lib/catalogFamily.js";

// The note picker popup (ticket 10). A filter bar over a detail list; each row
// is a checkbox. The selection accumulates across filter changes, so a user can
// pull notes from several collections into one batch. "Add selected (N)" adds
// and keeps the popup open; "Add & close" adds and closes it.
//
// Data loading: there is no global notes endpoint, so the picker fans out to
// the per-collection `GET /api/collections/:id/notes` for every collection the
// collections provider already loaded, and tags each note with its collection
// name so the cross-collection list stays legible. The fan-out is documented in
// the ticket; it is the cleanest read that needs no new endpoint.
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

  const collectionKey = collections.map((collection) => collection.id).join(",");

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
      await onAdd(ids);
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

        <div className="showcase-picker-list">
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

          {!loading && !loadError
            ? filtered.map((note) => {
                const isAdded = addedIds.has(note.id);
                const checked = isAdded || selectedIds.has(note.id);

                return (
                  <label
                    className={`showcase-note-row${isAdded ? " showcase-note-row--added" : ""}`}
                    key={note.id}
                  >
                    <input
                      aria-label={`${noteCaption(note)} ${note.catalog_number ?? ""} ${note.collection_name ?? ""}`.trim()}
                      checked={checked}
                      disabled={isAdded}
                      onChange={() => toggle(note.id)}
                      type="checkbox"
                    />
                    <span className="showcase-note-row-main">{noteCaption(note)}</span>
                    <span className="showcase-note-row-pill">
                      {note.catalog_number || "—"}
                    </span>
                    <span className="showcase-note-row-pill">
                      {note.collection_name}
                    </span>
                    {isAdded ? (
                      <span className="showcase-note-row-pill showcase-note-row-pill--added">
                        added
                      </span>
                    ) : null}
                  </label>
                );
              })
            : null}
        </div>

        <div className="showcase-picker-actions">
          <button
            className="button button-primary"
            disabled={!selectedIds.size || busy}
            onClick={() => add(false)}
            type="button"
          >
            Add selected ({selectedIds.size})
          </button>
          <button
            className="button"
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
