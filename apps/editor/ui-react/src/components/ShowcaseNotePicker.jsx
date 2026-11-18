import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getAllNotes } from "../lib/api.js";
import { matchesCatalogFamily } from "../lib/catalogFamily.js";
import { showcasePickerFields } from "../lib/noteFields.js";
import {
  firstAvailableNoteImage,
  pickNoteImage,
} from "../lib/showcaseImages.js";
import { SelectField } from "./SelectField.jsx";

// The note picker popup (ticket 10). A filter bar over a virtualized thumbnail
// list; each row is a checkbox with the note's first available image, and
// hovering (or focusing) the thumbnail shows the full-size image in a preview
// bubble. The selection accumulates across filter changes, so a user can pull
// notes from several collections into one batch. "Add selected (N)" adds and
// keeps the popup open; "Add & close" adds and closes it.
//
// Data loading: there is no global notes endpoint, so `getAllNotes` is the one
// seam that fans out to the per-collection `GET /api/collections/:id/notes`
// for every collection the collections provider already loaded, and tags each
// note with its collection name so the cross-collection list stays legible.
//
// Virtualization: the list uses `@tanstack/react-virtual` (already used by the
// Notes table) with a fixed row estimate, so collections with hundreds of notes
// only mount the visible window. Thumbnails reuse `firstAvailableNoteImage`
// (front thumbnail, then front full, then back) and lazy-load; the hover
// preview reuses the table's thumb-preview pattern (a positioned bubble that
// only mounts the full-size image while visible, clamped inside the list).
//
// Embedded is the specimen manager's append mode: the finder sits inline below
// the entry's specimens instead of owning a modal shell. It hides notes already
// attached (`excludeNoteIds`), chips each row Owned/Seen, and sorts owned
// matches first so a library record is one click away. Selection, filtering,
// and virtualization are the same as the standalone picker.
//
// Edit mode passes `mode`/`onModeChange`/`notice` to add the Notes ↔ Catalog
// entries switch and the inline skipped-notes line; `onAdd` then receives the
// active mode as its third argument. The append-mode finder leaves all three
// out.
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

function ShowcaseNotePicker({
  node,
  collections = [],
  embedded = false,
  excludeNoteIds,
  mode = "notes",
  notice = "",
  singleSelect = false,
  onAdd,
  onClose,
  onModeChange = null,
}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [column, setColumn] = useState("catalog");
  const [value, setValue] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [thumbPreview, setThumbPreview] = useState(null);
  const filterRef = useRef(null);
  const listRef = useRef(null);
  const thumbElementsRef = useRef(new Map());

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

  // Escape dismisses the popup, matching the shortcuts overlay and the image
  // popover. A click on the backdrop does the same; clicks inside the dialog
  // stop propagation so selecting notes never closes it. Embedded, the
  // manager's dialog owns Escape and the backdrop.
  useEffect(() => {
    if (embedded) {
      return undefined;
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [embedded, onClose]);

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

    getAllNotes(collections, showcasePickerFields)
      .then((payload) => {
        if (active) {
          setNotes(payload.notes);
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

  // The manager's append mode hides the entry's own specimens instead of
  // showing them disabled: there is nothing to pick on a note that is already
  // attached. A missing list keeps the standalone finder unchanged.
  const excludedIds = useMemo(
    () => new Set(excludeNoteIds ?? []),
    [excludeNoteIds],
  );

  const availableNotes = useMemo(
    () => notes.filter((note) => !excludedIds.has(note.id)),
    [excludedIds, notes],
  );

  const filtered = useMemo(
    () => filterNotes(availableNotes, column, value),
    [availableNotes, column, value],
  );

  // The catalog finder (the manager's append mode and an unseen card's finder)
  // treats owned records as the likely pick: their rows chip Owned/Seen and
  // owned matches lead. The draft finder keeps its plain collection order.
  const catalogFinder = embedded || node?.node_type === "catalog_entry";

  // In append mode a library record is the likelier pick, so owned notes lead.
  // The sort is stable: within each group the collection order is untouched.
  const visible = useMemo(
    () =>
      catalogFinder
        ? [...filtered].sort(
            (left, right) =>
              Number(Boolean(right.owned)) - Number(Boolean(left.owned)),
          )
        : filtered,
    [catalogFinder, filtered],
  );

  const rowVirtualizer = useVirtualizer({
    count: visible.length,
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

  function showThumbPreview(noteId) {
    setThumbPreview({ noteId, offsetY: 0 });
  }

  function hideThumbPreview(noteId) {
    setThumbPreview((current) =>
      current?.noteId === noteId ? null : current,
    );
  }

  // Keep the preview bubble inside the scrolling list: measure the hovered
  // thumbnail against the list viewport and shift the bubble so it never
  // bleeds past the top or bottom edge. Re-clamps on scroll and resize, and
  // drops the preview when its row scrolls out of the virtual window.
  useEffect(() => {
    if (!thumbPreview) {
      return undefined;
    }

    const shell = listRef.current;

    if (!shell) {
      return undefined;
    }

    function updatePreviewPosition() {
      const thumbElement = thumbElementsRef.current.get(thumbPreview.noteId);

      if (!thumbElement) {
        setThumbPreview(null);
        return;
      }

      const shellBounds = shell.getBoundingClientRect();
      const thumbBounds = thumbElement.getBoundingClientRect();
      const previewHeight = 186;
      const desiredTop =
        thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
      const minTop = shellBounds.top + 8;
      const maxTop = shellBounds.bottom - previewHeight - 8;
      const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
      const offsetY = Math.round(clampedTop - desiredTop);

      setThumbPreview((current) =>
        current && current.noteId === thumbPreview.noteId
          ? current.offsetY === offsetY
            ? current
            : { ...current, offsetY }
          : current,
      );
    }

    updatePreviewPosition();
    shell.addEventListener("scroll", updatePreviewPosition, { passive: true });
    window.addEventListener("resize", updatePreviewPosition);

    return () => {
      shell.removeEventListener("scroll", updatePreviewPosition);
      window.removeEventListener("resize", updatePreviewPosition);
    };
  }, [thumbPreview]);

  function toggle(noteId) {
    if (addedIds.has(noteId)) {
      return;
    }

    setSelectedIds((current) => {
      if (singleSelect) {
        return current.has(noteId) ? new Set() : new Set([noteId]);
      }

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

      visible.forEach((note) => {
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

      visible.forEach((note) => {
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
      await onAdd(ids, notes, mode);
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
    const previewPath = image
      ? pickNoteImage(note, image.type, "full") || image.path
      : "";
    const previewVisible = thumbPreview?.noteId === note.id && Boolean(previewPath);

    return (
      <label
        className={`showcase-note-row${isAdded ? " showcase-note-row--added" : ""}${selectedIds.has(note.id) ? " showcase-note-row--selected" : ""}`}
        title={isAdded ? "Already in this Showcase" : undefined}
      >
        <input
          aria-label={`${noteCaption(note)} ${note.catalog_number ?? ""} ${note.collection_name ?? ""}`.trim()}
          checked={checked}
          disabled={isAdded}
          onChange={() => toggle(note.id)}
          onBlur={() => hideThumbPreview(note.id)}
          onFocus={() => {
            if (previewPath) {
              showThumbPreview(note.id);
            }
          }}
          type="checkbox"
        />
        <span
          aria-hidden="true"
          className="showcase-note-row-thumb"
          onMouseEnter={() => {
            if (previewPath) {
              showThumbPreview(note.id);
            }
          }}
          onMouseLeave={() => hideThumbPreview(note.id)}
          ref={(element) => {
            if (element) {
              thumbElementsRef.current.set(note.id, element);
            } else {
              thumbElementsRef.current.delete(note.id);
            }
          }}
        >
          <span className="showcase-note-row-thumb-frame">
            {image ? (
              <img alt="" loading="lazy" src={image.path} />
            ) : (
              <span className="showcase-note-row-thumb-empty">No image</span>
            )}
          </span>
          {previewPath ? (
            <span
              className={`showcase-thumb-preview${previewVisible ? " is-visible" : ""}`}
              style={{
                "--showcase-thumb-preview-offset": `${thumbPreview?.noteId === note.id ? thumbPreview.offsetY : 0}px`,
              }}
            >
              {previewVisible ? <img alt="" src={previewPath} /> : null}
            </span>
          ) : null}
        </span>
        <span className="showcase-note-row-main">{noteCaption(note)}</span>
        <span className="showcase-note-row-pill">
          {note.catalog_number || "—"}
        </span>
        <span className="showcase-note-row-pill">{note.collection_name}</span>
        {catalogFinder ? (
          <span
            className={`showcase-note-row-pill ${
              note.owned
                ? "showcase-note-row-pill--owned"
                : "showcase-note-row-pill--seen"
            }`}
          >
            {note.owned ? "Owned" : "Seen"}
          </span>
        ) : null}
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

  const pickerBody = (
    <>
      {embedded ? (
        <h3 className="showcase-picker-title showcase-picker-title--embedded">
          Add notes
        </h3>
      ) : (
        <div className="showcase-picker-head">
          <h2 className="showcase-picker-title">
            {singleSelect
              ? `Replace “${nodeLabel}” with a note`
              : `Add notes to “${nodeLabel}”`}
          </h2>
          <button className="button" onClick={onClose} type="button">
            Done
          </button>
        </div>
      )}

      <div className="showcase-picker-filter">
        <SelectField
          ariaLabel="Filter column"
          onChange={setColumn}
          options={COLUMNS}
          value={column}
          wrapperClassName="showcase-picker-column"
        />
        <input
          aria-label="Filter value"
          autoFocus={!embedded}
          className="showcase-picker-value"
          onChange={(event) => setValue(event.target.value)}
          placeholder={activeColumn.placeholder}
          ref={filterRef}
          type="text"
          value={value}
        />
        {singleSelect ? null : (
          <>
            <button className="button" onClick={selectAll} type="button">
              Select all
            </button>
            <button className="button" onClick={deselectAll} type="button">
              Deselect all
            </button>
          </>
        )}
      </div>

      {onModeChange ? (
        <div
          aria-label="Add notes as"
          className="showcase-picker-modes"
          role="group"
        >
          <button
            aria-pressed={mode === "notes"}
            className="showcase-picker-mode"
            onClick={() => onModeChange("notes")}
            type="button"
          >
            Notes
          </button>
          <button
            aria-pressed={mode === "catalog"}
            className="showcase-picker-mode"
            onClick={() => onModeChange("catalog")}
            type="button"
          >
            Catalog entries
          </button>
        </div>
      ) : null}

      <p className="showcase-picker-hint">
        {mode === "catalog"
          ? "A note joins the entry with the same catalog value in this block; a note without one is skipped."
          : column === "catalog"
            ? "The catalog filter keeps the family rule: 22 matches 22, 22a, 22b, and 22s — never 220. A letters-only catalog base is a prefix, so M matches M1 and MA."
            : "The selection carries across filter changes, so you can pick notes from several collections."}
      </p>

      {notice ? (
        <p
          aria-live="polite"
          className="showcase-picker-notice"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {!loading && !loadError ? (
        <p aria-live="polite" className="muted showcase-picker-count">
          {filtered.length === availableNotes.length
            ? `${availableNotes.length} notes`
            : `${filtered.length} of ${availableNotes.length} notes`}
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

        {!loading && !loadError && visible.length === 0 ? (
          <p className="muted showcase-picker-empty">
            {availableNotes.length === 0 && notes.length > 0
              ? "Every note is already on this entry."
              : "No notes match."}
          </p>
        ) : null}

        {!loading && !loadError && visible.length > 0 ? (
          useVirtualList ? (
            <div
              className="showcase-picker-virtual"
              style={{ height: `${totalSize}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const note = visible[virtualRow.index];

                if (!note) {
                  return null;
                }

                // Each virtual row is translated, which creates its own
                // stacking context: without a lift, a later sibling row
                // paints above this row's preview bubble. Raise the row
                // carrying the open preview so the bubble stays on top.
                const isPreviewOpen = thumbPreview?.noteId === note.id;

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
                      zIndex: isPreviewOpen ? 10 : undefined,
                    }}
                  >
                    {renderNoteLabel(note)}
                  </div>
                );
              })}
            </div>
          ) : (
            visible.map((note) => {
              const isPreviewOpen = thumbPreview?.noteId === note.id;

              return (
                <div
                  key={note.id}
                  style={
                    isPreviewOpen
                      ? { position: "relative", zIndex: 10 }
                      : undefined
                  }
                >
                  {renderNoteLabel(note)}
                </div>
              );
            })
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
          {singleSelect
            ? "Use selected note"
            : `Add selected (${selectedIds.size})`}
        </button>
        {embedded || singleSelect ? null : (
          <button
            className="button button-primary"
            disabled={!selectedIds.size || busy}
            onClick={() => add(true)}
            type="button"
          >
            Add &amp; close
          </button>
        )}

        {addError ? (
          <p className="showcase-error" role="alert">
            {addError}
          </p>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return (
      <section
        aria-label="Add notes"
        className="showcase-picker showcase-picker--embedded"
      >
        {pickerBody}
      </section>
    );
  }

  return (
    <div className="showcase-picker-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label="Add notes"
        aria-modal="true"
        className="showcase-picker"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {pickerBody}
      </div>
    </div>
  );
}

export { ShowcaseNotePicker };
