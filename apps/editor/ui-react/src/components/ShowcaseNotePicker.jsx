import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getAllNotes } from "../lib/api.js";
import { showcasePickerFields } from "../lib/noteFields.js";
import { collectTagNames } from "../lib/tagNames.js";
import {
  applyPickerView,
  defaultPickerSortKey,
  pickerColumns,
} from "../lib/showcasePickerView.js";
import {
  firstAvailableNoteImage,
  pickNoteImage,
} from "../lib/showcaseImages.js";
import { TableFilterBar } from "./TableFilterBar.jsx";

// One picker surface for every "pick a library note" task: the Add dialog's
// Notes tab, the standalone finder a catalog entry opens, and the Replace
// finder a card's menu opens. The Table filter bar sits over a virtualized
// thumbnail list; committed chips, Add/Replace, ranges and negation behave as
// they do in the Table, and a sort control orders the list by any picker field.
//
// Every row is one aligned grid: the checkbox, the thumbnail, the note's
// caption, its catalog number, its grading, its collection and its Owned/Seen
// (or Added) state. The columns keep their x positions from row to row, so the
// list reads as a compact table even though it is not one.
//
// The list carries the Table's keyboard niceties at its own size: Down/j and
// Up/k walk the rows, Home/End jump to the ends, PageDown/PageUp page, Space
// (or Enter) toggles the focused note, and Up from the first row hands focus
// back to the filter. Down from the filter lands on the first selectable row.
// A row outside the virtual window scrolls in before it takes focus.
//
// Hovering a thumbnail shows the full-size image in a preview bubble. Keyboard
// navigation keeps the list quiet: the row cursor paints, but no preview opens
// under the pointer-less user. The selection accumulates across filter
// changes, so a user can pull notes from several collections into one batch.
// "Add selected (N)" adds and keeps the popup open; "Add & close" adds and
// closes it.
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
// Embedded is the Add dialog's Notes tab: the finder sits inline below the
// dialog's tabs instead of owning a second modal shell. It hides notes already
// attached (`excludeNoteIds`), chips each row Owned/Seen, and leads with owned
// matches in the default order so a library record is one click away.
// Selection, filtering, and virtualization are the same as the standalone
// picker.
//
// Edit mode passes `mode`/`onModeChange`/`notice` to add the Notes ↔ Catalog
// entries switch and the inline skipped-notes line; `onAdd` then receives the
// active mode as its third argument. The Add dialog's Notes tab leaves all
// three out.
const ROW_ESTIMATE = 64;

function noteCaption(note) {
  return [String(note.denomination ?? "").trim(), String(note.issue_date ?? "").trim()]
    .filter(Boolean)
    .join(" · ");
}

// A note's grading as one quiet value: a bare `66 EPQ` is ambiguous across
// companies, so the company that graded the note leads its grade.
function noteGrading(note) {
  const company = String(note?.grading_company ?? "").trim();
  const grade = String(note?.grade ?? "").trim();

  return [company, grade].filter(Boolean).join(" ");
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
  const [conditions, setConditions] = useState([]);
  const [sortKey, setSortKey] = useState(defaultPickerSortKey);
  const [sortDirection, setSortDirection] = useState("asc");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState("");
  const [thumbPreview, setThumbPreview] = useState(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const filterBarRef = useRef(null);
  const listRef = useRef(null);
  const panelRef = useRef(null);
  const selectAllRef = useRef(null);
  const thumbElementsRef = useRef(new Map());
  const rowElementsRef = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const activeNoteIdRef = useRef(null);
  const collectionKey = collections.map((collection) => collection.id).join(",");

  // The picker filter bar owns the only filter input, so `/` focuses it from
  // anywhere in the popup except a field the user is already typing in.
  useEffect(() => {
    function handleKeyDown(event) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      if (
        event.key !== "/" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        typing
      ) {
        return;
      }

      event.preventDefault();
      filterBarRef.current?.focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // The picker opens with its one filter input focused, whether it owns the
  // modal (Replace) or sits inside the Add dialog's Notes tab. The Add dialog
  // has no focus of its own, so this is also what moves focus into the modal.
  useEffect(() => {
    filterBarRef.current?.focus();
  }, []);

  // The standalone finder owns its modal shell, so Escape dismisses it and Tab
  // stays inside it. Embedded, the Add dialog owns both.
  useEffect(() => {
    if (embedded) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) {
        return;
      }

      const focusables = Array.from(
        panelRef.current.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [href], select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);

      if (!focusables.length) {
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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

  // The replacement finder hides the note the card already presents instead of
  // showing it disabled: there is nothing to pick on a note already attached.
  // A missing list keeps the standalone finder unchanged.
  const excludedIds = useMemo(
    () => new Set(excludeNoteIds ?? []),
    [excludeNoteIds],
  );

  const availableNotes = useMemo(
    () => notes.filter((note) => !excludedIds.has(note.id)),
    [excludedIds, notes],
  );

  // Tag names offered as suggestions by the filter bar. The picker only
  // suggests tags that some note already carries, exactly like the Table.
  const tagNames = useMemo(() => collectTagNames(notes), [notes]);

  // The catalog finder (the Add dialog and a replacement finder) treats owned
  // records as the likely pick: their rows chip Owned/Seen and owned matches
  // lead. The batch add finder keeps its plain collection order.
  const catalogFinder =
    embedded || singleSelect || node?.node_type === "catalog_entry";

  // Filter chips use the Table's condition model; the sort control replaces
  // the picker's default collection order once a field is chosen. Owned-first
  // stays a default-order affordance, not a competing sort.
  const visible = useMemo(
    () =>
      applyPickerView(availableNotes, {
        conditions,
        ownedFirst: catalogFinder,
        sortDirection,
        sortKey,
      }),
    [availableNotes, catalogFinder, conditions, sortDirection, sortKey],
  );

  // The header's select-all checkbox mirrors the visible window, not the
  // accumulated selection: a filter change can leave picks from another view
  // selected while the rows on screen are all clear.
  const selectableVisible = useMemo(
    () => visible.filter((note) => !addedIds.has(note.id)),
    [addedIds, visible],
  );
  const allVisibleSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((note) => selectedIds.has(note.id));
  const someVisibleSelected = selectableVisible.some((note) =>
    selectedIds.has(note.id),
  );

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate =
        someVisibleSelected && !allVisibleSelected;
    }
  }, [allVisibleSelected, someVisibleSelected]);

  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    estimateSize: () => ROW_ESTIMATE,
    getScrollElement: () => listRef.current,
    overscan: 10,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // The header sits outside the scrolling list, so it has to reserve the same
  // scrollbar gutter the rows lose. Measuring it keeps every column on the
  // row's own x position whether or not the list overflows.
  useEffect(() => {
    const list = listRef.current;

    if (!list) {
      return undefined;
    }

    function measure() {
      const width = Math.max(0, list.offsetWidth - list.clientWidth);
      setScrollbarWidth((current) => (current === width ? current : width));
    }

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [loading, visible.length]);

  // A new filter or sort is a new list: jump back to the top so the window
  // never opens mid-list on stale scroll, and drop the old row cursor.
  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
    pendingFocusRef.current = null;
    activeNoteIdRef.current = null;
  }, [conditions, rowVirtualizer, sortDirection, sortKey]);

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

  // The header checkbox is the picker's only bulk control: checked selects
  // every visible pickable note, unchecked (or indeterminate) clears them.
  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      deselectAll();
    } else {
      selectAll();
    }
  }

  // A header click cycles the column: ascending, descending, then back to the
  // picker's default collection order. The chevron disappears in the last
  // state, so "no arrow" always means "default order".
  function toggleSort(key) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDirection("asc");
      return;
    }

    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }

    setSortKey(defaultPickerSortKey);
    setSortDirection("asc");
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

  // The cursor is focus memory, not paint: the row's wash comes from
  // `:has(:focus-visible)`, so a mouse pick leaves only the checkbox checked
  // while the arrow keys still paint where they will go next.
  function setActiveRow(noteId) {
    activeNoteIdRef.current = noteId;
  }

  // The focused row is the cursor. Moving it scrolls the row into the list
  // viewport; a row that the virtualizer has not mounted yet is remembered and
  // focused by its ref callback once it mounts.
  function ensureRowVisible(element) {
    const shell = listRef.current;

    if (!shell) {
      return;
    }

    const shellBounds = shell.getBoundingClientRect();
    const rowBounds = element.getBoundingClientRect();

    if (rowBounds.top < shellBounds.top) {
      shell.scrollTop -= shellBounds.top - rowBounds.top;
    } else if (rowBounds.bottom > shellBounds.bottom) {
      shell.scrollTop += rowBounds.bottom - shellBounds.bottom;
    }
  }

  function focusRow(noteId) {
    const index = visible.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    const element = rowElementsRef.current.get(noteId);

    if (!element) {
      pendingFocusRef.current = noteId;
      setActiveRow(noteId);
      rowVirtualizer.scrollToIndex(index, { align: "auto" });
      return;
    }

    const checkbox = element.querySelector(
      'input[type="checkbox"]:not(:disabled)',
    );

    if (!checkbox) {
      return;
    }

    checkbox.focus({ preventScroll: true });
    setActiveRow(noteId);
    ensureRowVisible(element);
  }

  function registerRowElement(noteId, element) {
    if (!element) {
      rowElementsRef.current.delete(noteId);
      return;
    }

    rowElementsRef.current.set(noteId, element);

    if (pendingFocusRef.current !== noteId) {
      return;
    }

    pendingFocusRef.current = null;
    const checkbox = element.querySelector(
      'input[type="checkbox"]:not(:disabled)',
    );

    if (checkbox) {
      checkbox.focus({ preventScroll: true });
      setActiveRow(noteId);
      ensureRowVisible(element);
    }
  }

  function firstSelectableNote() {
    return visible.find((note) => !addedIds.has(note.id));
  }

  // Hand the filter bar's Down/Escape off to the first row, matching the Table.
  function focusFirstRow() {
    const first = firstSelectableNote();

    if (first) {
      focusRow(first.id);
    }
  }

  // Notes already on the entry are disabled, so walking the list steps over
  // them instead of parking the cursor on a row that cannot be picked.
  function selectableIndex(from, direction) {
    let index = from;

    while (index >= 0 && index < visible.length) {
      if (!addedIds.has(visible[index].id)) {
        return index;
      }

      index += direction;
    }

    return -1;
  }

  function moveRowFocus(offset) {
    if (!visible.length) {
      return;
    }

    const currentIndex = visible.findIndex(
      (note) => note.id === activeNoteIdRef.current,
    );

    // Up from the first row hands focus back to the filter, like the Table.
    if (offset < 0 && currentIndex === 0) {
      setActiveRow(null);
      filterBarRef.current?.focus();
      return;
    }

    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = selectableIndex(baseIndex + offset, offset > 0 ? 1 : -1);

    if (nextIndex >= 0) {
      focusRow(visible[nextIndex].id);
    }
  }

  function pageRows(direction) {
    if (!visible.length) {
      return;
    }

    const shell = listRef.current;
    const pageSize = Math.max(
      1,
      Math.floor((shell?.clientHeight || ROW_ESTIMATE * 5) / ROW_ESTIMATE),
    );
    const currentIndex = visible.findIndex(
      (note) => note.id === activeNoteIdRef.current,
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = selectableIndex(
      Math.min(
        Math.max(baseIndex + direction * pageSize, 0),
        visible.length - 1,
      ),
      direction > 0 ? 1 : -1,
    );

    if (nextIndex >= 0) {
      focusRow(visible[nextIndex].id);
    }
  }

  function focusEdgeRow(last) {
    const selectable = visible.filter((note) => !addedIds.has(note.id));

    if (!selectable.length) {
      return;
    }

    focusRow(selectable[last ? selectable.length - 1 : 0].id);
  }

  // One key handler for the whole list: rows hold the checkbox, so every
  // navigation key arrives here by bubbling.
  function handleListKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const target = event.target;

    if (
      !(target instanceof HTMLInputElement) ||
      target.type !== "checkbox" ||
      !target.closest(".showcase-note-row")
    ) {
      return;
    }

    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        moveRowFocus(1);
        return;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        moveRowFocus(-1);
        return;
      case "Home":
        event.preventDefault();
        focusEdgeRow(false);
        return;
      case "End":
        event.preventDefault();
        focusEdgeRow(true);
        return;
      case "PageDown":
        event.preventDefault();
        pageRows(1);
        return;
      case "PageUp":
        event.preventDefault();
        pageRows(-1);
        return;
      case "Enter":
        // Space is the native checkbox toggle; Enter is offered as the same
        // action so the list needs no modifier to pick a note.
        event.preventDefault();

        if (!target.disabled) {
          target.click();
        }
        return;
      default:
    }
  }

  const nodeLabel = node?.name ?? "this node";
  const pickerTitle = singleSelect
    ? `Replace “${nodeLabel}” with a note`
    : `Add notes to “${nodeLabel}”`;
  const pickerSubtitle = singleSelect
    ? "Pick a library note to take this card's place. The card keeps its position."
    : "Pick library notes to add to this card.";

  function renderNoteLabel(note) {
    const isAdded = addedIds.has(note.id);
    const checked = isAdded || selectedIds.has(note.id);
    const image = firstAvailableNoteImage(note);
    const previewPath = image
      ? pickNoteImage(note, image.type, "full") || image.path
      : "";
    const previewVisible = thumbPreview?.noteId === note.id && Boolean(previewPath);
    const statusTone = isAdded ? "added" : note.owned ? "owned" : "seen";
    const status = isAdded ? "Added" : note.owned ? "Owned" : "Seen";
    const grading = noteGrading(note);

    return (
      <label
        className={`showcase-note-row${catalogFinder ? " showcase-note-row--catalog" : ""}${isAdded ? " showcase-note-row--added" : ""}`}
        title={isAdded ? "Already in this Showcase" : undefined}
      >
        <input
          aria-label={[
            noteCaption(note),
            note.catalog_number,
            grading,
            note.collection_name,
          ]
            .filter(Boolean)
            .join(" ")}
          checked={checked}
          disabled={isAdded}
          onChange={() => toggle(note.id)}
          onBlur={() => hideThumbPreview(note.id)}
          onFocus={() => setActiveRow(note.id)}
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
        <span className="showcase-note-row-catalog">
          {note.catalog_number || "—"}
        </span>
        <span
          className="showcase-note-row-grading"
          title={grading || undefined}
        >
          {grading || "—"}
        </span>
        <span
          className="showcase-note-row-collection"
          title={note.collection_name || undefined}
        >
          {note.collection_name || "—"}
        </span>
        {catalogFinder ? (
          <span
            className={`showcase-note-row-status showcase-note-row-status--${statusTone}`}
          >
            {status}
          </span>
        ) : null}
      </label>
    );
  }

  // jsdom (and the first paint before the scroll element is measured) yields
  // no virtual rows; fall back to the plain list so the notes are still
  // visible and selectable. A measured browser always takes the virtual path.
  const useVirtualList = virtualRows.length > 0;

  const catalogRule = mode === "catalog"
    ? "A note joins the entry with the same catalog value in this block; a note without one is skipped."
    : conditions.some((condition) => condition.field === "catalog_number")
      ? "The catalog filter keeps the family rule: 22 matches 22, 22a, 22b, and 22s — never 220. A letters-only catalog base is a prefix, so M matches M1 and MA."
      : "";

  // One sortable header cell. The accessible name carries the state, because
  // the picker's header is a visual table, not a real one with aria-sort.
  function renderSortHeader(key, label, className = "") {
    const isSorted = sortKey === key;
    const state = isSorted
      ? sortDirection === "asc"
        ? "ascending"
        : "descending"
      : "";
    const title = isSorted
      ? sortDirection === "asc"
        ? `Sorted by ${label} ascending. Click for descending.`
        : `Sorted by ${label} descending. Click for the default order.`
      : `Sort by ${label}`;

    return (
      <div
        className={`showcase-picker-header-cell${className ? ` ${className}` : ""}`}
      >
        <button
          aria-label={`Sort by ${label}${state ? `, ${state}` : ""}`}
          className={`showcase-picker-sort-button${isSorted ? " showcase-picker-sort-button--active" : ""}${isSorted && sortDirection === "desc" ? " showcase-picker-sort-button--desc" : ""}`}
          onClick={() => toggleSort(key)}
          title={title}
          type="button"
        >
          {label}
          <svg
            aria-hidden="true"
            className="showcase-picker-sort-chevron"
            focusable="false"
            viewBox="0 0 24 24"
          >
            <path
              d="m6 15 6-6 6 6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.4"
            />
          </svg>
        </button>
      </div>
    );
  }

  const pickerBody = (
    <>
      <div className="showcase-picker-toolbar">
        <TableFilterBar
          conditions={conditions}
          hasRows={visible.length > 0}
          onConditionsChange={setConditions}
          onEscape={onClose}
          onFirstRow={focusFirstRow}
          popoverClassName="showcase-picker-popover"
          ref={filterBarRef}
          searchColumns={pickerColumns}
          tagNames={tagNames}
        />
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

      {catalogRule ? (
        <p className="showcase-picker-note">{catalogRule}</p>
      ) : null}

      {notice ? (
        <p
          aria-live="polite"
          className="showcase-picker-notice"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="showcase-picker-table">
        <div
          className={`showcase-picker-header${catalogFinder ? " showcase-picker-header--catalog" : ""}`}
          style={{ "--showcase-picker-scrollbar": `${scrollbarWidth}px` }}
        >
          <div className="showcase-picker-header-cell">
            {singleSelect ? (
              <span aria-hidden="true" />
            ) : (
              <input
                aria-label="Select all visible notes"
                checked={allVisibleSelected}
                disabled={!selectableVisible.length}
                onChange={toggleSelectAllVisible}
                ref={selectAllRef}
                type="checkbox"
              />
            )}
          </div>
          <span aria-hidden="true" />
          {renderSortHeader("denomination", "Note")}
          {renderSortHeader("catalog_number", "Catalog")}
          {renderSortHeader(
            "grade",
            "Grading",
            "showcase-picker-header-grading",
          )}
          {renderSortHeader(
            "collection_name",
            "Collection",
            "showcase-picker-header-collection",
          )}
          {catalogFinder ? (
            <div className="showcase-picker-header-cell">Status</div>
          ) : null}
        </div>

        <div
          className="showcase-picker-list"
          onBlur={(event) => {
            // Tab or a click outside the list drops the keyboard cursor
            // memory; moving between rows keeps it.
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setActiveRow(null);
            }
          }}
          onKeyDown={handleListKeyDown}
          ref={listRef}
        >
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

                        registerRowElement(note.id, element);
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
                    ref={(element) => registerRowElement(note.id, element)}
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
      </div>

      <div className="showcase-picker-actions">
        {!loading && !loadError ? (
          <p
            className="muted showcase-picker-count"
            title="The selection carries across filter changes, so you can pick notes from several collections."
          >
            {visible.length === availableNotes.length
              ? `${availableNotes.length} notes`
              : `${visible.length} of ${availableNotes.length} notes`}
            {selectedIds.size ? ` · ${selectedIds.size} selected` : ""}
          </p>
        ) : (
          <span />
        )}
        <div className="showcase-picker-action-buttons">
          <button
            className={`button${singleSelect || embedded ? " button-primary" : ""}`}
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
        </div>

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
    <div
      className="showcase-manager-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        aria-label={singleSelect ? "Replace note" : "Add notes"}
        aria-modal="true"
        className="showcase-manager showcase-add-dialog showcase-picker-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
        role="dialog"
      >
        <div className="showcase-manager-head">
          <h2 className="showcase-manager-title">{pickerTitle}</h2>
          <p className="showcase-manager-subtitle">{pickerSubtitle}</p>
          <button
            aria-label="Close note picker"
            className="showcase-add-close showcase-add-close--icon"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <svg
              aria-hidden="true"
              focusable="false"
              height="16"
              viewBox="0 0 24 24"
              width="16"
            >
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </div>
        <div className="showcase-picker-body">{pickerBody}</div>
      </div>
    </div>
  );
}

export { ShowcaseNotePicker };
