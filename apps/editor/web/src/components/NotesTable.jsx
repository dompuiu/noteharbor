import {
  Fragment,
  forwardRef,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLocation, useNavigate } from "react-router-dom";
import {
  deleteNote,
  getNotes,
  reorderNotes as saveNotesOrder,
} from "../lib/api.js";
import {
  copyTextToClipboard,
  formatNoteAsTsvRow,
} from "../lib/noteClipboard.js";
import { isEditableElement } from "../lib/editableElement.js";
import { isEmptyLibrary } from "../lib/libraryState.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import {
  shouldHandOffToFilters,
  useFilterFocusMemory,
} from "../lib/filterFocusMemory.js";
import {
  COLUMN_PAN_THRESHOLD_PX,
  COLUMN_SCROLL_STEP,
  clampColumnScrollLeft,
  columnPanScrollLeft,
  isColumnPanTarget,
} from "../lib/tableColumnPan.js";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { NoCollectionsPrompt } from "./NoCollectionsPrompt.jsx";
import { Slideshow } from "./Slideshow.jsx";
import { TagsField } from "./TagsField.jsx";

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
const columns = baseColumns;

const tableStateStorageKey = "noteharbor.notesTableState";
const validSortKeys = new Set(["id", ...columns.map(([key]) => key)]);
const rowHeightEstimate = 43;
const validPreviewKinds = new Set(["front", "back"]);
const slideshowFilterParamPrefix = "f_";
const slideshowFilterKeys = columns.map(([key]) => key);
const tagChipHorizontalPadding = 20;
const tagListGap = 8;
const tagChipMeasureSafetyMargin = 2;
const tagsPopoverWidth = 280;
const tagsPopoverMaxHeight = 320;
const tagsPopoverOpenDelay = 300;
const tagsPopoverCloseDelay = 150;

let tagTextMeasureContext = null;

function getTagTextMeasureContext() {
  if (tagTextMeasureContext || typeof document === "undefined") {
    return tagTextMeasureContext;
  }

  const probe = document.createElement("button");
  probe.className = "tag";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.textContent = "x";
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  context.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
  document.body.removeChild(probe);

  tagTextMeasureContext = context;
  return tagTextMeasureContext;
}

function measureTagChipWidth(text) {
  const context = getTagTextMeasureContext();

  if (!context) {
    return text.length * 8 + tagChipHorizontalPadding;
  }

  return (
    Math.ceil(context.measureText(text).width) +
    tagChipHorizontalPadding +
    tagChipMeasureSafetyMargin
  );
}

function computeVisibleTagPlan(tags, availableWidth) {
  if (!tags.length) {
    return { visibleTags: [], hiddenTags: [] };
  }

  const chipWidths = tags.map((tag) => measureTagChipWidth(tag.name));
  const fullWidth = chipWidths.reduce(
    (sum, width, index) => sum + width + (index > 0 ? tagListGap : 0),
    0,
  );

  if (fullWidth <= availableWidth) {
    return { visibleTags: tags, hiddenTags: [] };
  }

  for (
    let visibleCount = tags.length - 1;
    visibleCount >= 0;
    visibleCount -= 1
  ) {
    const hiddenCount = tags.length - visibleCount;
    let width = measureTagChipWidth(`+${hiddenCount}`);

    for (let i = 0; i < visibleCount; i += 1) {
      width += chipWidths[i] + tagListGap;
    }

    // At visibleCount 0 we always accept, so the "+N" counter is never
    // itself pushed out of view with no indicator left behind.
    if (width <= availableWidth || visibleCount === 0) {
      return {
        visibleTags: tags.slice(0, visibleCount),
        hiddenTags: tags.slice(visibleCount),
      };
    }
  }
}

// Anchors the popover under `bounds` (the trigger's rect), flipping above it
// when there isn't room below, given the popover's (real or estimated) height.
function computePopoverTop(bounds, height) {
  const spaceBelow = window.innerHeight - bounds.bottom - 6;
  const spaceAbove = bounds.top - 6;

  return spaceBelow >= height || spaceBelow >= spaceAbove
    ? Math.min(bounds.bottom + 6, window.innerHeight - height - 8)
    : Math.max(8, bounds.top - height - 6);
}

function TagsCell({ onApplyFilter, tags }) {
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const openTimeoutRef = useRef(null);
  const closeTimeoutRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const popoverHeightRef = useRef(null);

  useLayoutEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return undefined;
    }

    setAvailableWidth(element.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (entry) {
        setAvailableWidth(entry.contentRect.width);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setPopoverPosition(null);
      popoverHeightRef.current = null;
      return undefined;
    }

    function updatePosition() {
      const trigger = triggerRef.current;

      if (!trigger) {
        setIsOpen(false);
        return;
      }

      const bounds = trigger.getBoundingClientRect();
      const maxLeft = window.innerWidth - tagsPopoverWidth - 8;
      const left = Math.max(8, Math.min(bounds.left, maxLeft));

      // Before the popover has mounted (and given us a real height to
      // measure), fall back to its max possible height so the first paint
      // still avoids running off-screen; the layout effect below corrects
      // `top` using the real height as soon as it's known.
      const height =
        popoverHeightRef.current ??
        Math.min(tagsPopoverMaxHeight, window.innerHeight - 16);
      const top = computePopoverTop(bounds, height);

      setPopoverPosition({ top, left });
    }

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen]);

  // The first pass above has to guess the popover's height, since it hasn't
  // rendered yet. Once it has, re-derive `top` from its actual height so a
  // short tag list doesn't get positioned as if it were the max height.
  useLayoutEffect(() => {
    if (!isOpen || !popoverPosition || !popoverRef.current) {
      return;
    }

    const measuredHeight = popoverRef.current.getBoundingClientRect().height;

    if (popoverHeightRef.current === measuredHeight) {
      return;
    }

    popoverHeightRef.current = measuredHeight;

    const trigger = triggerRef.current;

    if (!trigger) {
      return;
    }

    const bounds = trigger.getBoundingClientRect();
    const top = computePopoverTop(bounds, measuredHeight);

    setPopoverPosition((current) => (current ? { ...current, top } : current));
  }, [isOpen, popoverPosition]);

  useEffect(() => {
    return () => {
      if (openTimeoutRef.current) {
        clearTimeout(openTimeoutRef.current);
      }

      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  function cancelScheduledOpen() {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
  }

  function cancelScheduledClose() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function handleTriggerMouseEnter() {
    cancelScheduledClose();
    cancelScheduledOpen();
    openTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, tagsPopoverOpenDelay);
  }

  function handleMouseLeave() {
    cancelScheduledOpen();
    cancelScheduledClose();
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, tagsPopoverCloseDelay);
  }

  function handleMouseEnterAgain() {
    cancelScheduledClose();
  }

  function handleTriggerFocus() {
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen(true);
  }

  function handleTriggerMouseDown(event) {
    // Clicking an unfocused button fires a native focus event before click.
    // Without this, handleTriggerFocus's setIsOpen(true) and this same
    // click's toggle in handleTriggerClick cancel each other out.
    event.preventDefault();
  }

  function handleTriggerClick(event) {
    event.stopPropagation();
    cancelScheduledOpen();
    cancelScheduledClose();
    setIsOpen((current) => !current);
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "Tab" && !event.shiftKey && isOpen) {
      const firstButton = popoverRef.current?.querySelector("button");

      if (firstButton) {
        event.preventDefault();
        firstButton.focus();
      }
    }
  }

  function handlePopoverFocus() {
    cancelScheduledClose();
  }

  function handlePopoverKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    }

    if (event.key === "Tab") {
      const buttons = Array.from(
        popoverRef.current?.querySelectorAll("button") ?? [],
      );
      const atLast =
        !event.shiftKey &&
        document.activeElement === buttons[buttons.length - 1];
      const atFirst = event.shiftKey && document.activeElement === buttons[0];

      if (atLast || atFirst) {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
  }

  const { visibleTags, hiddenTags } = !tags.length
    ? { visibleTags: [], hiddenTags: [] }
    : availableWidth == null
      ? { visibleTags: tags, hiddenTags: [] }
      : computeVisibleTagPlan(tags, availableWidth);

  return (
    <div className="tag-list tag-list-clip" ref={containerRef}>
      {!tags.length ? <span className="muted">-</span> : null}
      {visibleTags.map((tag) => (
        <button
          className="tag"
          key={tag.id || tag.name}
          onClick={(event) => {
            event.stopPropagation();
            onApplyFilter(tag.name, { replace: event.shiftKey });
          }}
          title={tag.name}
          type="button"
        >
          {tag.name}
        </button>
      ))}
      {hiddenTags.length ? (
        <span className="tag-more-wrap">
          <button
            aria-label={`${hiddenTags.length} more tags`}
            className="tag tag-more"
            onBlur={handleMouseLeave}
            onClick={handleTriggerClick}
            onFocus={handleTriggerFocus}
            onKeyDown={handleTriggerKeyDown}
            onMouseDown={handleTriggerMouseDown}
            onMouseEnter={handleTriggerMouseEnter}
            onMouseLeave={handleMouseLeave}
            ref={triggerRef}
            type="button"
          >
            +{hiddenTags.length}
          </button>
          {isOpen && popoverPosition
            ? createPortal(
                <div
                  className="tag-popover"
                  onBlur={handleMouseLeave}
                  onFocus={handlePopoverFocus}
                  onKeyDown={handlePopoverKeyDown}
                  onMouseEnter={handleMouseEnterAgain}
                  onMouseLeave={handleMouseLeave}
                  ref={popoverRef}
                  style={{
                    top: popoverPosition.top,
                    left: popoverPosition.left,
                  }}
                >
                  {hiddenTags.map((tag) => (
                    <button
                      className="tag"
                      key={tag.id || tag.name}
                      onClick={(event) => {
                        event.stopPropagation();
                        onApplyFilter(tag.name, { replace: event.shiftKey });
                        setIsOpen(false);
                      }}
                      title={tag.name}
                      type="button"
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>,
                document.body,
              )
            : null}
        </span>
      ) : null}
    </div>
  );
}

const MultiValueFilterCombobox = forwardRef(function MultiValueFilterCombobox(
  {
    columnLabel,
    onArrowDown,
    onChange,
    onFocus,
    onHeightChange,
    options,
    value,
  },
  forwardedRef,
) {
  const selectedValues = useMemo(
    () =>
      String(value ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean),
    [value],
  );

  return (
    <TagsField
      ref={forwardedRef}
      value={selectedValues}
      vocabulary={options}
      onChange={(nextValues) => onChange(nextValues.join(","))}
      onArrowDown={onArrowDown}
      ariaLabel={`Filter ${columnLabel}`}
      emptyText=""
      inputProps={{ onFocus }}
      placeholder=""
      onHeightChange={onHeightChange}
    />
  );
});

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

function valueToString(note, key) {
  if (key === "tags") {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

function parseFilterValue(rawValue, normalizeValue) {
  const normalized = String(rawValue ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return { negated: false, value: "" };
  }

  const negated = normalized.startsWith("!");
  const rawParsedValue = negated ? normalized.slice(1).trim() : normalized;
  const value = normalizeValue
    ? normalizeValue(rawParsedValue)
    : rawParsedValue;
  return value ? { negated, value } : { negated: false, value: "" };
}

function addThousandsSeparators(value) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeDenominationFilterValue(value) {
  const trimmed = String(value ?? "").trim();
  const match = trimmed.match(/^(\d[\d,]*)(\.\d+)?(.*)$/);
  if (!match) {
    return trimmed;
  }

  const [, rawIntegerPart, decimalPart = "", suffix = ""] = match;
  const integerDigits = rawIntegerPart.replace(/,/g, "");
  if (!/^\d+$/.test(integerDigits)) {
    return trimmed;
  }

  return `${addThousandsSeparators(integerDigits)}${decimalPart}${suffix}`;
}

function parseScalarFilters(rawFilterValue, normalizeValue) {
  return String(rawFilterValue ?? "")
    .split(",")
    .map((value) => parseFilterValue(value, normalizeValue))
    .filter(({ value }) => value);
}

function matchesSingleFilterValue(
  noteValue,
  filterValue,
  matchMode = "includes",
) {
  return matchMode === "catalogPrefix"
    ? matchesCatalogFilterValue(noteValue, filterValue)
    : matchMode === "startsWith"
      ? noteValue.startsWith(filterValue)
      : noteValue.includes(filterValue);
}

function matchesFilterValue(
  noteValue,
  rawFilterValue,
  matchMode = "includes",
  options = {},
) {
  const normalizedNoteValue = String(noteValue ?? "").toLowerCase();
  const filters = options.multiple
    ? parseScalarFilters(rawFilterValue, options.normalizeFilterValue)
    : [parseFilterValue(rawFilterValue, options.normalizeFilterValue)].filter(
        ({ value }) => value,
      );

  if (!filters.length) {
    return true;
  }

  const positiveFilters = filters.filter(({ negated }) => !negated);
  const negativeFilters = filters.filter(({ negated }) => negated);

  if (positiveFilters.length) {
    const hasPositiveMatch = positiveFilters.some(({ value }) =>
      matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
    );
    if (!hasPositiveMatch) {
      return false;
    }
  }

  return negativeFilters.every(
    ({ value }) =>
      !matchesSingleFilterValue(normalizedNoteValue, value, matchMode),
  );
}

function matchesCatalogFilterValue(noteValue, filterValue) {
  if (!noteValue.startsWith(filterValue)) {
    return false;
  }

  const nextCharacter = noteValue.charAt(filterValue.length);
  return !nextCharacter || !/\d/.test(nextCharacter);
}

function matchesTagFilter(note, rawFilterValue) {
  const filters = parseScalarFilters(rawFilterValue);

  if (!filters.length) {
    return true;
  }

  const noteTagNames = note.tags.map((tag) =>
    String(tag.name ?? "")
      .trim()
      .toLowerCase(),
  );
  return filters.every(({ negated, value }) => {
    const hasMatch = noteTagNames.some((tagName) => tagName.startsWith(value));
    return negated ? !hasMatch : hasMatch;
  });
}

function noteOrderValue(note) {
  const value = Number(note.display_order);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

// One shared collator: same result as String.localeCompare with these
// options, without rebuilding the collator on every comparison.
const rowSortCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function filterNotesByFilters(noteList, filterObj) {
  const activeFilters = filterObj ?? {};
  return noteList.filter((note) =>
    columns.every(([key]) => {
      if (key === "tags") {
        return matchesTagFilter(note, activeFilters[key]);
      }

      const supportsMultipleValues =
        key === "catalog_number" ||
        key === "grade" ||
        key === "issue_date" ||
        key === "denomination";

      return matchesFilterValue(
        valueToString(note, key),
        activeFilters[key],
        key === "catalog_number" ? "catalogPrefix" : "includes",
        {
          multiple: supportsMultipleValues,
          normalizeFilterValue:
            key === "denomination"
              ? normalizeDenominationFilterValue
              : undefined,
        },
      );
    }),
  );
}

function sortNotesBySort(noteList, key, direction) {
  const sortKey = validSortKeys.has(key) ? key : "id";
  const sortDirection = direction === "desc" ? "desc" : "asc";
  return [...noteList].sort((left, right) => {
    if (sortKey === "id") {
      const orderResult = noteOrderValue(left) - noteOrderValue(right);
      const result = orderResult || left.id - right.id;
      return sortDirection === "asc" ? result : -result;
    }

    const leftValue = valueToString(left, sortKey).toLowerCase();
    const rightValue = valueToString(right, sortKey).toLowerCase();
    const result = rowSortCollator.compare(leftValue, rightValue);
    return sortDirection === "asc" ? result : -result;
  });
}

function applyTableView(noteList, filterObj, key, direction) {
  return sortNotesBySort(
    filterNotesByFilters(noteList, filterObj),
    key,
    direction,
  );
}

// Where a delete leaves the cursor, resolved against the list the delete is
// applied to. `rowNoteId` is the note that slides into the highest removed
// slot, or the new last row when the removals ran past the end; it is null
// when no removed note was on screen. `emptiesView` is true when the
// deletions take the last visible row, which needs the table anchor instead
// of a row. The slot is picked before the delete because a position cannot be
// resolved against a list that no longer contains the removed rows.
function deleteFocusAfterRemoval(noteList, removedIds) {
  const removed = new Set(removedIds);
  const remaining = noteList.filter((note) => !removed.has(note.id));
  const firstRemovedIndex = noteList.findIndex((note) => removed.has(note.id));

  return {
    rowNoteId:
      firstRemovedIndex < 0 || !remaining.length
        ? null
        : remaining[Math.min(firstRemovedIndex, remaining.length - 1)].id,
    emptiesView: noteList.length > 0 && !remaining.length,
  };
}

// Where the slideshow lands after the note with `removedId` leaves its list:
// the note that slips into the removed slot, else the one before it, else the
// first. Null means the list emptied and there is no slide to land on. Resolved
// against the list the delete is applied to, before the removal lands, so the
// landing is known before the route-sync effect reacts to the shorter list.
function slideshowLandingNoteId(noteList, removedId) {
  const removedIndex = noteList.findIndex((note) => note.id === removedId);

  if (removedIndex < 0) {
    return null;
  }

  const remaining = noteList.filter((note) => note.id !== removedId);

  if (!remaining.length) {
    return null;
  }

  const landing =
    remaining[removedIndex] ?? remaining[removedIndex - 1] ?? remaining[0];

  return landing.id;
}

function versionedImagePath(path, version) {
  if (!path) {
    return null;
  }

  const separator = path.includes("?") ? "&" : "?";
  return version ? `${path}${separator}v=${encodeURIComponent(version)}` : path;
}

function pickImage(note, type, variant = "full") {
  const imagePath =
    note.images.find(
      (image) => image.type === type && image.variant === variant,
    )?.localPath ?? null;

  return versionedImagePath(imagePath, note.updated_at);
}

function pickFirstAvailableImage(note, slots) {
  for (const [type, variant] of slots) {
    const imagePath = pickImage(note, type, variant);
    if (imagePath) {
      return { path: imagePath, type, variant };
    }
  }

  return null;
}

function parsePositiveInteger(value) {
  const parsedValue = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function emptyTableRoute() {
  return {
    beforeId: null,
    kind: "table",
    noteId: null,
    overlayCreate: false,
    overlayEdit: false,
    previewKind: null,
    slideshowCollectionId: null,
    slideshowFilters: null,
    slideshowSortDirection: null,
    slideshowSortKey: null,
  };
}

// A route whose overlay is creating a new Note, or a top-level create route.
function isCreateRoute(route) {
  return route.kind === "create" || Boolean(route.overlayCreate);
}

// A route that edits an existing Note, either directly or over the slideshow.
function isEditNoteRoute(route) {
  return (route.kind === "edit" || Boolean(route.overlayEdit)) &&
    !route.overlayCreate;
}

function hasSlideshowContext(route) {
  return Boolean(
    route &&
      route.kind === "slideshow" &&
      (route.slideshowCollectionId != null ||
        route.slideshowFilters != null ||
        route.slideshowSortKey != null ||
        route.slideshowSortDirection != null),
  );
}

function parseSlideshowFilters(params) {
  let hasFilterParam = false;
  const filters = {};

  for (const key of slideshowFilterKeys) {
    if (!params.has(`${slideshowFilterParamPrefix}${key}`)) {
      continue;
    }

    hasFilterParam = true;
    const value = String(
      params.get(`${slideshowFilterParamPrefix}${key}`) ?? "",
    );

    if (value.trim()) {
      filters[key] = value;
    }
  }

  return hasFilterParam ? filters : null;
}

function parseSlideshowSortKey(value) {
  const normalized = String(value ?? "").trim();
  return validSortKeys.has(normalized) ? normalized : null;
}

function parseSlideshowSortDirection(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return null;
}

function parseTableHash(hash) {
  const normalizedHash = String(hash ?? "").replace(/^#/, "");

  if (!normalizedHash) {
    return emptyTableRoute();
  }

  const [rawPath, rawQuery = ""] = normalizedHash.split("?");
  const segments = rawPath.split("/").filter(Boolean);
  const params = new URLSearchParams(rawQuery);

  if (segments[0] === "new") {
    return {
      ...emptyTableRoute(),
      beforeId: parsePositiveInteger(params.get("before")),
      kind: "create",
    };
  }

  if (segments[0] === "edit") {
    const noteId = parsePositiveInteger(segments[1]);
    return noteId
      ? {
          ...emptyTableRoute(),
          kind: "edit",
          noteId,
        }
      : emptyTableRoute();
  }

  if (segments[0] === "slideshow") {
    const noteId = parsePositiveInteger(segments[1]);

    if (!noteId) {
      return emptyTableRoute();
    }

    const previewKind =
      segments[2] === "preview" && segments[3]
        ? String(segments[3]).toLowerCase()
        : null;

    return {
      ...emptyTableRoute(),
      kind: "slideshow",
      noteId,
      overlayCreate: params.get("overlay") === "create",
      overlayEdit: params.get("overlay") === "edit",
      previewKind,
      slideshowCollectionId: parsePositiveInteger(params.get("collection")),
      slideshowFilters: parseSlideshowFilters(params),
      slideshowSortDirection: parseSlideshowSortDirection(params.get("dir")),
      slideshowSortKey: parseSlideshowSortKey(params.get("sort")),
    };
  }

  return emptyTableRoute();
}

function buildTableHash(route) {
  if (!route || route.kind === "table") {
    return "";
  }

  if (route.kind === "create") {
    const params = new URLSearchParams();

    if (route.beforeId) {
      params.set("before", String(route.beforeId));
    }

    const query = params.toString();
    return `#new${query ? `?${query}` : ""}`;
  }

  if (route.kind === "edit" && route.noteId) {
    return `#edit/${route.noteId}`;
  }

  if (route.kind === "slideshow" && route.noteId) {
    const params = new URLSearchParams();
    let path = `#slideshow/${route.noteId}`;

    if (route.previewKind) {
      path += `/preview/${route.previewKind}`;
    }

    if (route.overlayEdit) {
      params.set("overlay", "edit");
    } else if (route.overlayCreate) {
      params.set("overlay", "create");
    }

    if (Number.isInteger(route.slideshowCollectionId)) {
      params.set("collection", String(route.slideshowCollectionId));
    }

    if (route.slideshowFilters) {
      for (const key of slideshowFilterKeys) {
        const value = route.slideshowFilters[key];
        if (value != null && String(value).trim()) {
          params.set(`${slideshowFilterParamPrefix}${key}`, String(value));
        }
      }
    }

    if (route.slideshowSortKey) {
      params.set("sort", String(route.slideshowSortKey));
    }

    if (route.slideshowSortDirection) {
      params.set("dir", String(route.slideshowSortDirection));
    }

    const query = params.toString();
    return `${path}${query ? `?${query}` : ""}`;
  }

  return "";
}

function NotesTable({
  activeCollection,
  activeCollectionId,
  collections,
  collectionsError,
  loadingCollections,
  onSelectCollection,
}) {
  const initialTableStateRef = useRef(undefined);
  const initialRouteRef = useRef(
    typeof window === "undefined"
      ? emptyTableRoute()
      : parseTableHash(window.location.hash),
  );
  const rowElementMapRef = useRef(new Map());
  const thumbPreviewElementMapRef = useRef(new Map());
  const dragPreviewRef = useRef(null);
  const tableShellRef = useRef(null);
  const tableScrollXRef = useRef(null);
  const tableScrollYRef = useRef(null);
  const columnPanRef = useRef(null);
  const suppressColumnPanClickRef = useRef(false);
  const vMetricsRef = useRef({ max: 0, range: 0, thumbHeight: 0 });
  const vThumbDragRef = useRef(null);
  const editorOverlayRef = useRef(null);
  const focusedRowIdRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
  const currentRouteRef = useRef(null);
  const skipFilterResetOnCollectionChangeRef = useRef(false);
  const pendingRowFocusNoteIdRef = useRef(null);
  const focusRestoreNoteIdRef = useRef(null);
  // The row the keyboard cursor last landed on, kept apart from
  // `focusedRowIdRef` because it has to outlive focus leaving the table:
  // opening the note editor moves focus into the overlay and drops the live
  // cursor, but closing the editor hands the cursor back to this row. Only a
  // change of row order invalidates it.
  const lastRowFocusNoteIdRef = useRef(null);
  // A focus request that has to wait for `orderedNotes` to reflect the
  // change that produced it — a newly created note, or a deleted row's
  // neighbour. `focusRowByNoteId` cannot resolve a note the current list
  // does not contain yet, so the request is held until the next list, then
  // dropped if the note never arrives (filtered out, or moved to another
  // collection).
  const deferredRowFocusNoteIdRef = useRef(null);
  // The sibling of the deferred row focus: a delete that empties the table
  // still has the editor overlay mounted when it runs, so the anchor it needs
  // to focus is inert. The request is held until the list settles.
  const deferredAnchorFocusRef = useRef(false);
  // A delete from the Notes editor records the slide it should land on before
  // it removes the note. The route-sync effect is the single place that reacts
  // to a route whose note has left the list, so it consumes this intent and
  // moves the slideshow on rather than bouncing to the Table.
  const pendingSlideshowLandingRef = useRef(null);
  const clearRowCursor = useCallback(() => {
    // The keyboard cursor is focus memory plus paint: both must drop
    // together so the highlight can never outlive its focus target or
    // vice versa. The last-focused-row memory is deliberately left alone —
    // it is what lets the editor overlay hand the cursor back on close.
    focusedRowIdRef.current = null;
    setActiveNoteId(null);
  }, []);
  // A mouse press focuses the row before any drag or click resolves. The
  // flag marks that focus as mouse-driven so it claims focus memory but
  // not the cursor paint: selection happens on drop, keyboard moves, and
  // slideshow return — never on mouse down.
  const mouseFocusSuppressRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  if (initialTableStateRef.current === undefined) {
    initialTableStateRef.current = loadSavedTableState();
  }

  const [notes, setNotes] = useState([]);
  // When landing directly on a slideshow URL carrying filter+sort context,
  // seed the table behind the slideshow from the URL so closing the
  // slideshow returns to the same filtered view.
  const [filters, setFilters] = useState(() => {
    if (initialRouteRef.current?.kind === "slideshow") {
      const routeFilters = initialRouteRef.current.slideshowFilters;
      if (routeFilters) {
        return { ...routeFilters };
      }
    }
    return initialTableStateRef.current?.filters ?? {};
  });
  const [sortKey, setSortKey] = useState(() => {
    if (initialRouteRef.current?.kind === "slideshow") {
      const routeSortKey = initialRouteRef.current.slideshowSortKey;
      if (routeSortKey && validSortKeys.has(routeSortKey)) {
        return routeSortKey;
      }
    }
    return initialTableStateRef.current?.sortKey ?? "id";
  });
  const [sortDirection, setSortDirection] = useState(() => {
    if (initialRouteRef.current?.kind === "slideshow") {
      const routeSortDirection =
        initialRouteRef.current.slideshowSortDirection;
      if (
        routeSortDirection === "asc" ||
        routeSortDirection === "desc"
      ) {
        return routeSortDirection;
      }
    }
    return initialTableStateRef.current?.sortDirection ?? "asc";
  });
  const [selectedIds, setSelectedIds] = useState(
    () => initialTableStateRef.current?.selectedIds ?? [],
  );
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [moveToast, setMoveToast] = useState("");
  const moveToastTimerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [columnsDragging, setColumnsDragging] = useState(false);
  const [thumbPreviewState, setThumbPreviewState] = useState(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [columnFilterHeights, setColumnFilterHeights] = useState({});
  const [vScroll, setVScroll] = useState({
    bottom: 4,
    thumbHeight: 0,
    thumbTop: 0,
    top: 0,
    valueNow: 0,
    visible: false,
  });
  const selectAllRef = useRef(null);
  const editorDirtyRef = useRef(false);
  const confirmOpenRef = useRef(false);
  const closeEditorRef = useRef(null);
  const { confirm: requestConfirmation, dialog: confirmDialog, isOpen: confirmOpen } =
    useConfirmation();
  confirmOpenRef.current = confirmOpen;
  const handleEditorDirtyChange = useCallback((dirty) => {
    editorDirtyRef.current = dirty;
  }, []);

  useEffect(() => {
    return () => {
      if (moveToastTimerRef.current) {
        clearTimeout(moveToastTimerRef.current);
      }
    };
  }, []);

  const showSelection = true;
  const showReorder = true;
  const showActions = true;
  // An empty library is not an outage; a failed load keeps its inline
  // `collectionsError` instead.
  const noCollections = isEmptyLibrary({
    collections,
    collectionsError,
    loadingCollections,
  });
  const visibleColumns = baseColumns;
  const filterColumnKeys = useMemo(
    () => visibleColumns.map(([key]) => key),
    [visibleColumns],
  );
  const {
    focusFilter,
    focusRememberedFilter,
    getFilterRef,
    rememberFilter,
  } = useFilterFocusMemory(filterColumnKeys);
  const filterRowHeight = Object.keys(columnFilterHeights).length
    ? Math.max(32, ...Object.values(columnFilterHeights))
    : null;
  const allTagNames = useMemo(() => {
    const seen = new Map();

    notes.forEach((note) => {
      note.tags.forEach((tag) => {
        const name = String(tag.name ?? "").trim();
        const key = name.toLowerCase();

        if (name && !seen.has(key)) {
          seen.set(key, name);
        }
      });
    });

    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [notes]);
  const currentRoute = useMemo(
    () => parseTableHash(location.hash),
    [location.hash],
  );
  // Latest route for effects that must not re-run on route changes (e.g.
  // the filter reset below, which answers only to collection changes).
  currentRouteRef.current = currentRoute;
  const orderedNotes = useMemo(
    () => applyTableView(notes, filters, sortKey, sortDirection),
    [filters, notes, sortDirection, sortKey],
  );
  // The painted row list lags one step behind the filter state: inputs,
  // chips, and counts stay instant while the heavy row re-mount happens in
  // a background render. Everything that reads note *identity* (selection,
  // nav, slideshow) keeps using the urgent list.
  const deferredOrderedNotes = useDeferredValue(orderedNotes);
  const rowsPending = deferredOrderedNotes !== orderedNotes;
  const defaultOrderedNotes = useMemo(
    () =>
      [...notes].sort((left, right) => {
        const orderResult = noteOrderValue(left) - noteOrderValue(right);
        return orderResult || left.id - right.id;
      }),
    [notes],
  );
  const slideshowRouteActive = currentRoute.kind === "slideshow";
  const creatingNote = isCreateRoute(currentRoute);
  const editingNoteId = isEditNoteRoute(currentRoute)
    ? currentRoute.noteId
    : null;
  // The editor is a modal overlay: while it is open, the table and the
  // slideshow behind it must not be reachable, so a stray Tab cannot click
  // "Edit note", the toolbar, or a row and discard unsaved work silently.
  const editorOverlayOpen = Boolean(editingNoteId || creatingNote);
  const createPositionReferenceId = creatingNote
    ? currentRoute.beforeId &&
      notes.some((note) => note.id === currentRoute.beforeId)
      ? currentRoute.beforeId
      : currentRoute.overlayCreate &&
          slideshowNotes.some((note) => note.id === currentRoute.noteId)
        ? currentRoute.noteId
        : null
    : null;
  const createPositionMode = createPositionReferenceId ? "before" : "end";
  const slideshowIndex = slideshowRouteActive
    ? slideshowNotes.findIndex((note) => note.id === currentRoute.noteId)
    : -1;
  // The Note editor counts and navigates within the list it was opened from:
  // the slideshow's frozen list when opened over it, the current table view
  // otherwise. This is what makes "5" mean the same thing in both places.
  const editorList =
    slideshowRouteActive && slideshowNotes.length
      ? slideshowNotes
      : orderedNotes;
  const editingNoteIndex = editingNoteId
    ? editorList.findIndex((note) => note.id === editingNoteId)
    : -1;
  // Where the incoming Note will sit: before the reference Note, or at the
  // end of the list. The arrows and typed jumps move relative to that slot,
  // wrapping around the ends exactly as edit mode does.
  const createSlotIndex = creatingNote
    ? (() => {
        if (createPositionReferenceId == null) {
          return editorList.length;
        }

        const referenceIndex = editorList.findIndex(
          (note) => note.id === createPositionReferenceId,
        );
        return referenceIndex < 0 ? editorList.length : referenceIndex;
      })()
    : -1;
  // The note at `index` in the editor's list, wrapping around the ends (only
  // the Note editor wraps; the Table screen keeps its clamps).
  function noteAtWrappedIndex(index) {
    const length = editorList.length;
    return editorList[((index % length) + length) % length];
  }
  const editorNavigation = (() => {
    if (creatingNote) {
      if (!editorList.length) {
        return { previous: null, next: null };
      }

      // The incoming Note would sit at `createSlotIndex`; "next" is the note
      // it lands before, or the first Note when it lands at the end.
      return {
        previous: noteAtWrappedIndex(createSlotIndex - 1).id,
        next: noteAtWrappedIndex(createSlotIndex).id,
      };
    }

    if (editingNoteIndex >= 0 && editorList.length > 1) {
      return {
        previous: noteAtWrappedIndex(editingNoteIndex - 1).id,
        next: noteAtWrappedIndex(editingNoteIndex + 1).id,
      };
    }

    return { previous: null, next: null };
  })();
  const previousEditingNoteId = editorNavigation.previous;
  const nextEditingNoteId = editorNavigation.next;
  const currentEditingNotePosition =
    editingNoteIndex >= 0 ? editingNoteIndex + 1 : null;
  const totalNotesInEditorList = editorList.length;

  // The note list encoded in a slideshow URL (filter + sort snapshot taken
  // when the slideshow was opened). Recomputed live so a cold-opened tab
  // (new tab, refresh, bookmark) rebuilds the same 1/6-style list instead
  // of falling back to the unfiltered collection order.
  const slideshowContextNotes = useMemo(() => {
    if (currentRoute.kind !== "slideshow") {
      return null;
    }

    if (!hasSlideshowContext(currentRoute)) {
      return null;
    }

    const contextFilters = currentRoute.slideshowFilters ?? {};
    const contextSortKey =
      currentRoute.slideshowSortKey &&
      validSortKeys.has(currentRoute.slideshowSortKey)
        ? currentRoute.slideshowSortKey
        : "id";
    const contextSortDirection =
      currentRoute.slideshowSortDirection === "desc" ? "desc" : "asc";

    return applyTableView(
      notes,
      contextFilters,
      contextSortKey,
      contextSortDirection,
    );
  }, [currentRoute, notes]);

  function navigateToTableRoute(nextRoute, { replace = false } = {}) {
    const nextHash = buildTableHash(nextRoute);
    const nextUrl = `${location.pathname}${nextHash}`;
    navigate(nextUrl || CATALOG_ROUTES.banknotes, { replace });
  }

  // Context carried on every slideshow URL: the filter+sort snapshot the
  // list was opened with. In-slideshow moves reuse the route's snapshot so
  // the list stays frozen; a fresh open snapshots the live table instead.
  function slideshowRouteContext() {
    if (
      currentRoute.kind === "slideshow" &&
      hasSlideshowContext(currentRoute)
    ) {
      return {
        slideshowCollectionId: currentRoute.slideshowCollectionId,
        slideshowFilters: currentRoute.slideshowFilters,
        slideshowSortDirection: currentRoute.slideshowSortDirection,
        slideshowSortKey: currentRoute.slideshowSortKey,
      };
    }

    return {
      slideshowCollectionId: Number.isInteger(activeCollectionId)
        ? activeCollectionId
        : null,
      slideshowFilters: { ...filters },
      slideshowSortDirection: sortDirection,
      slideshowSortKey: sortKey,
    };
  }

  // One shape for every slideshow URL: the context snapshot the list was
  // opened with, plus the optional overlay/preview state. Callers vary only
  // the Note and those flags, so the route is built in one place.
  function slideshowRoute(noteId, overrides = {}) {
    return {
      kind: "slideshow",
      noteId,
      overlayCreate: false,
      overlayEdit: false,
      previewKind: null,
      ...slideshowRouteContext(),
      ...overrides,
    };
  }

  const totalColumnCount =
    visibleColumns.length +
    2 +
    (showSelection ? 1 : 0) +
    (showReorder ? 1 : 0) +
    (showActions ? 1 : 0) +
    // Trailing gutter column in the header that the rows stop before, so
    // the overlay scrollbar never covers row content.
    (vScroll.visible ? 1 : 0);

  async function loadNotes() {
    if (!Number.isInteger(activeCollectionId)) {
      setNotes([]);
      return [];
    }

    const payload = await getNotes(activeCollectionId);
    setNotes(payload.notes);
    return payload.notes;
  }

  useEffect(() => {
    if (loadingCollections) {
      return;
    }

    if (!Number.isInteger(activeCollectionId)) {
      setLoading(false);
      setNotes([]);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError("");

    getNotes(activeCollectionId)
      .then((notesPayload) => {
        if (active) {
          setNotes(notesPayload.notes);
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
  }, [activeCollectionId, loadingCollections]);

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => notes.some((note) => note.id === id)),
    );
  }, [notes]);

  // A slideshow URL names its collection: switch to it so a cold-opened
  // tab lands on the same notes even when another collection is active.
  useEffect(() => {
    if (currentRoute.kind !== "slideshow") {
      return;
    }

    const targetCollectionId = currentRoute.slideshowCollectionId;

    if (!Number.isInteger(targetCollectionId)) {
      return;
    }

    if (targetCollectionId === activeCollectionId) {
      return;
    }

    if (loadingCollections) {
      return;
    }

    if (!collections.some((entry) => entry.id === targetCollectionId)) {
      return;
    }

    skipFilterResetOnCollectionChangeRef.current = true;
    onSelectCollection(targetCollectionId);
  }, [
    activeCollectionId,
    collections,
    currentRoute,
    loadingCollections,
    onSelectCollection,
  ]);

  // Filters reset only when the active collection actually changes. Route
  // changes (opening/closing the slideshow) leave them alone, and while a
  // slideshow URL with filter+sort context is open the URL owns them.
  useEffect(() => {
    resetColumnScroll();

    if (skipFilterResetOnCollectionChangeRef.current) {
      skipFilterResetOnCollectionChangeRef.current = false;
      return;
    }

    const route = currentRouteRef.current;

    if (route?.kind === "slideshow" && hasSlideshowContext(route)) {
      return;
    }

    setFilters({});
  }, [activeCollectionId]);

  useEffect(() => {
    if (!slideshowRouteActive || !slideshowNotes.length) {
      return;
    }

    setSlideshowNotes((current) => {
      if (!current.length) {
        return current;
      }

      const notesById = new Map(notes.map((note) => [note.id, note]));
      const nextNotes = current
        .map((note) => notesById.get(note.id))
        .filter(Boolean);

      if (
        nextNotes.length === current.length &&
        nextNotes.every((note, index) => note === current[index])
      ) {
        return current;
      }

      return nextNotes;
    });
  }, [notes, slideshowNotes.length, slideshowRouteActive]);

  useEffect(() => {
    if (loading) {
      return;
    }

    if (currentRoute.kind === "table") {
      setSlideshowNotes([]);
      return;
    }

    if (currentRoute.kind === "create") {
      if (
        currentRoute.beforeId &&
        !notes.some((note) => note.id === currentRoute.beforeId)
      ) {
        navigateToTableRoute({ kind: "create" }, { replace: true });
      }

      setSlideshowNotes([]);
      return;
    }

    if (currentRoute.kind === "edit") {
      if (!notes.some((note) => note.id === currentRoute.noteId)) {
        navigateToTableRoute(emptyTableRoute(), { replace: true });
        return;
      }

      setSlideshowNotes([]);
      return;
    }

    const hasSlideshowUrlContext = hasSlideshowContext(currentRoute);
    // A slideshow URL carrying filter+sort context rebuilds that exact list,
    // so a new tab, refresh, or bookmark keeps the same 1/N position.
    // Legacy URLs without context keep the previous behavior below.
    let baseNotes = null;

    if (hasSlideshowUrlContext) {
      // While the collection switch is still landing, notes belong to the
      // wrong collection: wait instead of bouncing back to the table.
      if (
        Number.isInteger(currentRoute.slideshowCollectionId) &&
        currentRoute.slideshowCollectionId !== activeCollectionId
      ) {
        return;
      }

      baseNotes = slideshowContextNotes ?? [];
    } else {
      const hasRestoredTableState = Boolean(initialTableStateRef.current);
      baseNotes =
        initialRouteRef.current.kind === "slideshow" &&
        slideshowNotes.length === 0 &&
        !hasRestoredTableState
          ? defaultOrderedNotes
          : orderedNotes;
    }

    const targetIndex = baseNotes.findIndex(
      (note) => note.id === currentRoute.noteId,
    );

    if (targetIndex < 0) {
      const pendingLanding = pendingSlideshowLandingRef.current;

      // A delete that removed this route's note recorded where to land. The
      // route itself is intentionally still on the removed note for the render
      // this effect runs for, so consume the intent instead of treating the
      // hand-off as a vanished slide.
      if (pendingLanding && pendingLanding.removedId === currentRoute.noteId) {
        pendingSlideshowLandingRef.current = null;
        navigateToTableRoute(
          pendingLanding.landingId == null
            ? emptyTableRoute()
            : slideshowRoute(pendingLanding.landingId),
          { replace: true },
        );
        return;
      }

      navigateToTableRoute(emptyTableRoute(), { replace: true });
      return;
    }

    setSlideshowNotes((current) => {
      if (
        current.length === baseNotes.length &&
        current.every((note, index) => note.id === baseNotes[index]?.id)
      ) {
        return current;
      }

      return baseNotes;
    });

    if (
      currentRoute.previewKind &&
      !validPreviewKinds.has(currentRoute.previewKind)
    ) {
      navigateToTableRoute(
        {
          kind: "slideshow",
          noteId: currentRoute.noteId,
          overlayCreate: currentRoute.overlayCreate,
          overlayEdit: currentRoute.overlayEdit,
          previewKind: null,
          slideshowCollectionId: currentRoute.slideshowCollectionId,
          slideshowFilters: currentRoute.slideshowFilters,
          slideshowSortDirection: currentRoute.slideshowSortDirection,
          slideshowSortKey: currentRoute.slideshowSortKey,
        },
        { replace: true },
      );
    }
  }, [
    activeCollectionId,
    currentRoute,
    defaultOrderedNotes,
    loading,
    notes,
    orderedNotes,
    slideshowContextNotes,
    slideshowNotes.length,
  ]);

  useEffect(() => {
    if (!editorOverlayOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      // While a confirmation is open, Escape belongs to the dialog.
      if (confirmOpenRef.current) {
        return;
      }

      // A focused field gets the first Escape: blurring it keeps the user in
      // the editor, so closing the screen takes a second press.
      const activeElement = document.activeElement;
      const fieldFocused =
        isEditableElement(activeElement) &&
        editorOverlayRef.current?.contains(activeElement);

      if (fieldFocused) {
        activeElement.blur();
        return;
      }

      guardEditorExit(() => closeEditorRef.current?.());
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [editorOverlayOpen]);

  useEffect(() => {
    if (!editorOverlayOpen) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (editorOverlayRef.current) {
        editorOverlayRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [editorOverlayOpen]);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((value) => String(value).trim()),
    [filters],
  );
  const isDefaultOrder = sortKey === "id" && sortDirection === "asc";
  const canReorder =
    showReorder && !hasActiveFilters && isDefaultOrder && !reorderLoading;

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = useMemo(
    () =>
      orderedNotes.length > 0 &&
      orderedNotes.every((note) => selectedIdSet.has(note.id)),
    [orderedNotes, selectedIdSet],
  );
  const someVisibleSelected = useMemo(
    () => orderedNotes.some((note) => selectedIdSet.has(note.id)),
    [orderedNotes, selectedIdSet],
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
    count: deferredOrderedNotes.length,
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => tableScrollYRef.current,
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

  useEffect(() => {
    // A changed filter or sort produces a new row order: drop any keyboard
    // focus target from the previous order (including a not-yet-landed
    // virtualized focus) so the next ArrowDown starts at the first row of
    // the new order. The active-row cue belongs to the old order too, and so
    // do the last-focused-row memory and any focus still waiting on a list
    // change: they name rows of the old order.
    pendingRowFocusNoteIdRef.current = null;
    deferredRowFocusNoteIdRef.current = null;
    deferredAnchorFocusRef.current = false;
    pendingSlideshowLandingRef.current = null;
    lastRowFocusNoteIdRef.current = null;
    clearRowCursor();
  }, [clearRowCursor, filters, sortDirection, sortKey]);

  useEffect(() => {
    // Land a focus request that was made while the list was still settling.
    // The note is looked up instead of focused at request time because a
    // create appends it and a delete removes a neighbour, and neither is in
    // the list on the render that started the request.
    const noteId = deferredRowFocusNoteIdRef.current;

    if (noteId != null) {
      deferredRowFocusNoteIdRef.current = null;

      if (orderedNotes.some((note) => note.id === noteId)) {
        focusRowByNoteId(noteId);
      } else if (!orderedNotes.length) {
        // The request named a note that left the view (moved to another
        // collection, fell out of the filter) and took the last row with it:
        // there is no row to land on, so use the anchor rather than <body>.
        focusTableAnchor();
      }
      return;
    }

    // A delete that emptied the view asked for the anchor, but the editor
    // overlay was still mounted (and inert) when it made the request; land it
    // now that the list has settled.
    if (deferredAnchorFocusRef.current) {
      deferredAnchorFocusRef.current = false;
      focusTableAnchor();
    }
    // `focusRowByNoteId` reads the list of the render it runs in, so it must
    // not be a dependency: including it would fire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedNotes]);

  // The vertical scrollbar is custom-drawn so its track spans only the rows
  // area below the sticky header (a native scrollbar would always run the
  // full height of the scroll container, header included). These metrics
  // keep the custom thumb in sync with the inner vertical scroller.
  const updateVScroll = useCallback(() => {
    const scroller = tableScrollYRef.current;
    const xScroller = tableScrollXRef.current;

    if (!scroller || !xScroller) {
      return;
    }

    const max = scroller.scrollHeight - scroller.clientHeight;

    if (max <= 1) {
      vMetricsRef.current = { max: 0, range: 0, thumbHeight: 0 };
      setVScroll((current) =>
        current.visible ? { ...current, visible: false } : current,
      );
      return;
    }

    const headerHeight = scroller.querySelector("thead")?.offsetHeight ?? 0;
    // The horizontal scrollbar is hidden now, so the vertical track runs to
    // the bottom edge instead of stopping above a bar.
    const top = headerHeight + 4;
    const bottom = 4;
    const trackHeight = Math.max(0, xScroller.clientHeight - top - bottom);

    if (trackHeight <= 40) {
      vMetricsRef.current = { max: 0, range: 0, thumbHeight: 0 };
      setVScroll((current) =>
        current.visible ? { ...current, visible: false } : current,
      );
      return;
    }

    const thumbHeight = Math.max(
      24,
      Math.min(
        trackHeight,
        (scroller.clientHeight / scroller.scrollHeight) * trackHeight,
      ),
    );
    const range = Math.max(1, trackHeight - thumbHeight);
    const ratio = Math.min(1, Math.max(0, scroller.scrollTop / max));
    vMetricsRef.current = { max, range, thumbHeight };

    const next = {
      bottom,
      thumbHeight,
      thumbTop: ratio * range,
      top,
      valueNow: Math.round(ratio * 100),
      visible: true,
    };

    setVScroll((current) =>
      current.visible === next.visible &&
      current.top === next.top &&
      current.bottom === next.bottom &&
      current.thumbHeight === next.thumbHeight &&
      current.thumbTop === next.thumbTop &&
      current.valueNow === next.valueNow
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const scroller = tableScrollYRef.current;
    const xScroller = tableScrollXRef.current;

    if (!scroller) {
      return undefined;
    }

    let frameId = 0;

    function scheduleUpdate() {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(updateVScroll);
    }

    updateVScroll();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    xScroller?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroller);

    if (xScroller) {
      observer.observe(xScroller);
    }

    const header = scroller.querySelector("thead");

    if (header) {
      observer.observe(header);
    }

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      scroller.removeEventListener("scroll", scheduleUpdate);
      xScroller?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [filterRowHeight, loading, deferredOrderedNotes.length, updateVScroll]);

  function handleVThumbPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const scroller = tableScrollYRef.current;

    if (!scroller) {
      return;
    }

    vThumbDragRef.current = {
      startScrollTop: scroller.scrollTop,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleVThumbPointerMove(event) {
    const drag = vThumbDragRef.current;
    const scroller = tableScrollYRef.current;
    const metrics = vMetricsRef.current;

    if (
      !drag ||
      !scroller ||
      !metrics ||
      metrics.max <= 0 ||
      metrics.range <= 0
    ) {
      return;
    }

    scroller.scrollTop =
      drag.startScrollTop +
      ((event.clientY - drag.startY) * metrics.max) / metrics.range;
  }

  function handleVThumbPointerEnd() {
    vThumbDragRef.current = null;
  }

  function handleVTrackPointerDown(event) {
    if (event.target !== event.currentTarget) {
      return;
    }

    const scroller = tableScrollYRef.current;
    const metrics = vMetricsRef.current;

    if (!scroller || !metrics || metrics.max <= 0 || metrics.range <= 0) {
      return;
    }

    const trackBounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(
        0,
        (event.clientY - trackBounds.top - metrics.thumbHeight / 2) /
          metrics.range,
      ),
    );
    scroller.scrollTop = ratio * metrics.max;
  }

  function handleVThumbKeyDown(event) {
    const scroller = tableScrollYRef.current;

    if (!scroller) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      scroller.scrollTop += rowHeightEstimate;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      scroller.scrollTop -= rowHeightEstimate;
    } else if (event.key === "PageDown") {
      event.preventDefault();
      // Stop the key from reaching the table's global handler, which would
      // page a second time.
      event.stopPropagation();
      pageTable(1);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      // Stop the key from reaching the table's global handler, which would
      // page a second time.
      event.stopPropagation();
      pageTable(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      event.stopPropagation();

      if (orderedNotes[0]) {
        focusRowByNoteId(orderedNotes[0].id);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      const lastNote = orderedNotes[orderedNotes.length - 1];

      if (lastNote) {
        focusRowByNoteId(lastNote.id);
      }
    }
  }

  // Returns the horizontal scroller when the columns actually overflow, so
  // panning is a no-op on a wide window just like the Viewer's table.
  function columnScroller() {
    const scroller = tableScrollXRef.current;

    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) {
      return null;
    }

    return scroller;
  }

  function scrollColumnsTo(scroller, left) {
    // Chromium animates the pan; jsdom (tests) has no scrollTo, so fall back
    // to a direct assignment there.
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ behavior: "smooth", left });
      return;
    }

    scroller.scrollLeft = left;
  }

  function panColumnsBy(delta) {
    const scroller = columnScroller();

    if (!scroller) {
      return false;
    }

    scrollColumnsTo(
      scroller,
      clampColumnScrollLeft(
        scroller.scrollLeft,
        delta,
        scroller.scrollWidth - scroller.clientWidth,
      ),
    );
    return true;
  }

  function panColumnsToEdge(forward) {
    const scroller = columnScroller();

    if (!scroller) {
      return false;
    }

    scrollColumnsTo(scroller, forward ? scroller.scrollWidth : 0);
    return true;
  }

  function resetColumnScroll() {
    const scroller = tableScrollXRef.current;

    if (scroller) {
      scroller.scrollLeft = 0;
    }
  }

  function handleColumnPanPointerDown(event) {
    // Clear first so a missed pointerup cannot leave a stale pending pan
    // that would suppress focus on a later, unrelated press.
    columnPanRef.current = null;
    const scroller = columnScroller();

    if (
      event.button !== 0 ||
      event.pointerType === "touch" ||
      !scroller ||
      !isColumnPanTarget(event.target)
    ) {
      return;
    }

    columnPanRef.current = {
      active: false,
      pointerId: event.pointerId,
      startScrollLeft: scroller.scrollLeft,
      startX: event.clientX,
    };
  }

  function handleColumnPanMouseDown(event) {
    // Pointerdown fires before mousedown and already armed the pan, so a
    // press that can start a pan must stay focus-neutral: cancelling the
    // press's default focus action keeps the active row's DOM focus, focus
    // memory, and highlight intact. The follow-up click is unaffected, so
    // ordinary clicks still fire; a completed pan swallows its own click.
    if (columnPanRef.current) {
      event.preventDefault();
    }
  }

  function handleColumnPanPointerMove(event) {
    const pan = columnPanRef.current;
    const scroller = tableScrollXRef.current;

    if (!pan || !scroller || event.pointerId !== pan.pointerId) {
      return;
    }

    const deltaX = event.clientX - pan.startX;

    if (!pan.active) {
      if (Math.abs(deltaX) < COLUMN_PAN_THRESHOLD_PX) {
        return;
      }

      pan.active = true;
      setColumnsDragging(true);

      if (typeof scroller.setPointerCapture === "function") {
        scroller.setPointerCapture(event.pointerId);
      }

      window.getSelection()?.removeAllRanges();
    }

    event.preventDefault();
    scroller.scrollLeft = columnPanScrollLeft({
      startScrollLeft: pan.startScrollLeft,
      startX: pan.startX,
      clientX: event.clientX,
      max: scroller.scrollWidth - scroller.clientWidth,
    });
  }

  function handleColumnPanPointerEnd(event) {
    const pan = columnPanRef.current;

    if (
      !pan ||
      (event?.pointerId != null && event.pointerId !== pan.pointerId)
    ) {
      return;
    }

    if (pan.active) {
      // The drag finishes with a click on whatever was under the pointer;
      // swallow that one click so a pan ending on a row does not open the
      // note. The timer clears the flag if no click follows.
      suppressColumnPanClickRef.current = true;
      window.setTimeout(() => {
        suppressColumnPanClickRef.current = false;
      }, 0);
    }

    columnPanRef.current = null;
    // The row clears this on its own mouseup, but a pan captures the
    // pointer to the scroller so the row's mouseup may never run. Reset
    // here so a stale press flag cannot suppress a later keyboard paint.
    mouseFocusSuppressRef.current = false;
    setColumnsDragging(false);
  }

  function handleColumnPanClickCapture(event) {
    if (!suppressColumnPanClickRef.current) {
      return;
    }

    suppressColumnPanClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    if (!thumbPreviewState) {
      return undefined;
    }

    const shell = tableScrollYRef.current;

    if (!shell) {
      return undefined;
    }

    function updateThumbPreviewPosition() {
      const thumbElement = thumbPreviewElementMapRef.current.get(
        thumbPreviewState.noteId,
      );

      if (!thumbElement) {
        setThumbPreviewState(null);
        return;
      }

      const shellBounds = shell.getBoundingClientRect();
      const thumbBounds = thumbElement.getBoundingClientRect();
      const headerBottom =
        shell.querySelector("thead")?.getBoundingClientRect().bottom ??
        shellBounds.top;
      const previewHeight = 138;
      const desiredTop =
        thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
      const minTop = Math.max(shellBounds.top + 8, headerBottom + 8);
      const maxTop = shellBounds.bottom - previewHeight - 8;
      const clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
      const offsetY = Math.round(clampedTop - desiredTop);

      setThumbPreviewState((current) =>
        current && current.noteId === thumbPreviewState.noteId
          ? current.offsetY === offsetY
            ? current
            : { ...current, offsetY }
          : current,
      );
    }

    updateThumbPreviewPosition();
    shell.addEventListener("scroll", updateThumbPreviewPosition, {
      passive: true,
    });
    window.addEventListener("resize", updateThumbPreviewPosition);

    return () => {
      shell.removeEventListener("scroll", updateThumbPreviewPosition);
      window.removeEventListener("resize", updateThumbPreviewPosition);
    };
  }, [thumbPreviewState]);

  useEffect(() => {
    if (!slideshowRouteActive && focusRestoreNoteIdRef.current != null) {
      const noteId = focusRestoreNoteIdRef.current;
      focusRestoreNoteIdRef.current = null;
      focusRowByNoteId(noteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideshowRouteActive]);

  useEffect(() => {
    // Unmounting a focused row fires no blur event: the browser drops focus
    // to <body> and the keyboard cursor would silently die. When focus lands
    // anywhere that is not a table row, drop the active-row cue and its
    // focus memory so the highlight cannot go stale. Focus on <body> (the
    // unmount case) is deliberately ignored here — the row ref callback
    // reclaims focus when the active row remounts.
    function handleFocusIn(event) {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }

      if (event.target.closest("tr.table-row-link")) {
        return;
      }

      if (
        document.activeElement === document.body ||
        event.target === document.body
      ) {
        return;
      }

      clearRowCursor();
    }

    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [clearRowCursor]);

  useEffect(() => {
    function handleGlobalKeyDown(event) {
      if (showShortcutsHelp || confirmOpenRef.current) {
        return;
      }

      const editable = isEditableElement(event.target);
      const tableKeysActive =
        !slideshowRouteActive && !editorOverlayOpen;

      // The sidebar owns its keys while it holds focus. Bail before any of the
      // table's single-key handling so the rail's cursor and navigation win.
      if (
        event.target instanceof Element &&
        event.target.closest("#app-sidebar")
      ) {
        return;
      }

      // Cmd/Ctrl/Shift + Left/Right (or h/l) jumps to the first/last column,
      // like the Viewer. Checked before the modifier guard below so it is not
      // swallowed. The uppercase spellings cover a held Shift and Caps Lock.
      const pointsToEnd =
        event.key === "ArrowRight" || event.key === "l" || event.key === "L";
      const pointsToStart =
        event.key === "ArrowLeft" || event.key === "h" || event.key === "H";

      if (
        tableKeysActive &&
        (event.metaKey || event.ctrlKey || event.shiftKey) &&
        !event.altKey &&
        !editable &&
        (pointsToEnd || pointsToStart) &&
        panColumnsToEdge(pointsToEnd)
      ) {
        event.preventDefault();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "?" && !editable) {
        event.preventDefault();
        setShowShortcutsHelp(true);
        return;
      }

      if (slideshowRouteActive || editorOverlayOpen) {
        return;
      }

      if (event.key === "/" && !editable) {
        event.preventDefault();
        focusRememberedFilter();
        return;
      }

      if (editable) {
        if (event.key === "Escape" && event.target.closest("thead")) {
          event.preventDefault();
          // Leave the filter and land straight on the first row (Esc
          // behaves like ArrowDown here). With no rows to land on, fall
          // back to the focus anchor so a further Escape can still clear
          // the filters.
          if (orderedNotes[0]) {
            focusRowByNoteId(orderedNotes[0].id);
          } else {
            focusTableAnchor();
            clearRowCursor();
          }
        }
        return;
      }

      // Row focus only moves for the plain keys: a held Shift rests the focus
      // where it is instead of pulling it to another note.
      if (!event.shiftKey && (event.key === "ArrowDown" || event.key === "j")) {
        event.preventDefault();
        moveRowFocus(1);
        return;
      }

      if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "k")) {
        event.preventDefault();
        moveRowFocus(-1);
        return;
      }

      if (pointsToStart || pointsToEnd) {
        const delta = pointsToStart ? -COLUMN_SCROLL_STEP : COLUMN_SCROLL_STEP;

        if (panColumnsBy(delta)) {
          event.preventDefault();
        }
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        pageTable(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const note =
          event.key === "Home"
            ? orderedNotes[0]
            : orderedNotes[orderedNotes.length - 1];

        if (note) {
          focusRowByNoteId(note.id);
        }
        return;
      }

      if (
        event.key === "Escape" &&
        event.target instanceof HTMLElement &&
        event.target.classList.contains("table-row-link")
      ) {
        event.preventDefault();
        // Focus the anchor right before the table (instead of just calling
        // blur()) so a following Tab press lands on the header's "select
        // all" checkbox rather than wherever the browser's default tab
        // order would otherwise resume from.
        focusTableAnchor();
        clearRowCursor();
        return;
      }

      if (
        event.key === "Escape" &&
        event.target === tableFocusAnchorRef.current
      ) {
        // Deselected-row state (see above): one more Escape clears the
        // filters, if any are set. Focus stays on the anchor.
        if (hasActiveFilters) {
          event.preventDefault();
          setFilters({});
        }
        return;
      }

      const focusedRowElement = focusedRowIdRef.current
        ? rowElementMapRef.current.get(focusedRowIdRef.current)
        : null;
      const rowHasFocus =
        Boolean(focusedRowElement) &&
        document.activeElement === focusedRowElement;
      // Focusing any control inside a row bubbles focus to the row, so the
      // row cursor can still be "on" a row while a nested button holds focus.
      // `contains` keeps "a" inserting before that row instead of treating it
      // as no row at all.
      const focusWithinFocusedRow =
        Boolean(focusedRowElement) &&
        focusedRowElement.contains(document.activeElement);

      // "a" opens the create form: before the focused row when the cursor is
      // on (or inside) one, otherwise it falls back to the toolbar's Add
      // action so the shortcut still works from an empty focus state or right
      // after the row cursor was cleared.
      if (event.key === "a") {
        // An empty library has no collection to create a note in. The toolbar
        // button is disabled; the shortcut has to match it.
        if (noCollections) {
          return;
        }

        event.preventDefault();

        if (focusWithinFocusedRow) {
          openCreateNoteBefore(focusedRowIdRef.current);
        } else {
          openCreateNote();
        }

        return;
      }

      if (!rowHasFocus) {
        return;
      }

      const focusedNote = orderedNotes.find(
        (note) => note.id === focusedRowIdRef.current,
      );

      if (!focusedNote) {
        return;
      }

      if (event.key === "e") {
        event.preventDefault();
        openEditor(focusedNote.id);
        return;
      }

      if (event.key === "d") {
        event.preventDefault();
        void handleDeleteNote(focusedNote.id);
        return;
      }

      if (event.key === "c") {
        event.preventDefault();
        void handleCopyNoteDetails(focusedNote);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    clearRowCursor,
    creatingNote,
    editingNoteId,
    hasActiveFilters,
    noCollections,
    orderedNotes,
    rowVirtualizer,
    slideshowRouteActive,
    showShortcutsHelp,
  ]);

  function resetTableState() {
    setFilters({});
    setSortKey("id");
    setSortDirection("asc");
    if (showSelection) {
      setSelectedIds([]);
    }
  }

  function reportColumnFilterHeight(key, height) {
    setColumnFilterHeights((current) =>
      current[key] === height ? current : { ...current, [key]: height },
    );
  }

  function applyTagFilter(tagName, { replace = false } = {}) {
    setFilters((current) => {
      if (replace) {
        return { ...current, tags: tagName };
      }

      const existingTags = String(current.tags ?? "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);
      const alreadyIncluded = existingTags.some(
        (tag) => tag.toLowerCase() === tagName.toLowerCase(),
      );
      const nextTags = alreadyIncluded
        ? existingTags
        : [...existingTags, tagName];

      return {
        ...current,
        tags: nextTags.join(","),
      };
    });

    resetColumnScroll();

    window.requestAnimationFrame(() => {
      focusFilter("tags");
    });
  }

  function showThumbPreview(noteId) {
    setThumbPreviewState({ noteId, offsetY: 0 });
  }

  function hideThumbPreview(noteId) {
    setThumbPreviewState((current) =>
      current?.noteId === noteId ? null : current,
    );
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
    setActiveNoteId(null);
    const noteId = startId ?? orderedNotes[0]?.id ?? null;

    if (!noteId) {
      return;
    }

    navigateToTableRoute(slideshowRoute(noteId));
  }

  function closeSlideshow() {
    focusRestoreNoteIdRef.current = currentRoute.noteId;
    setActiveNoteId(currentRoute.noteId);
    resetColumnScroll();
    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function focusTableAnchor() {
    // With no rows left there is no row to land on. Keeping focus on the
    // anchor rather than letting it fall to <body> preserves the table's
    // Escape and Tab behaviour.
    tableFocusAnchorRef.current?.focus({ preventScroll: true });
  }

  function landFocusAfterDelete({ rowNoteId, emptiesView }) {
    if (rowNoteId != null) {
      deferredRowFocusNoteIdRef.current = rowNoteId;
    } else if (emptiesView) {
      deferredAnchorFocusRef.current = true;
    }
  }

  function focusRowByNoteId(noteId, options = {}) {
    if (noteId == null) {
      return;
    }

    const element = rowElementMapRef.current.get(noteId);

    if (element) {
      // Native focus scrolling ignores the sticky header and can leave
      // the row hidden underneath it, so suppress it and reveal the row
      // explicitly instead.
      element.focus({ preventScroll: true });
      focusedRowIdRef.current = noteId;
      setActiveNoteId(noteId);

      if (options.pinToTop) {
        pinRowToTop(element);
      } else {
        ensureRowVisible(element);
      }
      return;
    }

    const index = orderedNotes.findIndex((note) => note.id === noteId);

    if (index < 0) {
      return;
    }

    pendingRowFocusNoteIdRef.current = noteId;
    setActiveNoteId(noteId);
    rowVirtualizer.scrollToIndex(index, {
      align: options.pinToTop ? "start" : "auto",
    });
  }

  function moveRowFocus(offset) {
    if (!orderedNotes.length) {
      return;
    }

    const currentIndex = orderedNotes.findIndex(
      (note) => note.id === focusedRowIdRef.current,
    );
    const currentElement =
      currentIndex === 0
        ? (rowElementMapRef.current.get(focusedRowIdRef.current) ?? null)
        : null;

    if (
      shouldHandOffToFilters({
        activeElement: document.activeElement,
        currentIndex,
        offset,
        rowElement: currentElement,
      }) &&
      focusRememberedFilter()
    ) {
      clearRowCursor();
      return;
    }

    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      orderedNotes.length - 1,
    );

    focusRowByNoteId(orderedNotes[nextIndex].id);
  }

  function handleFilterArrowDown(event) {
    if (
      event.key !== "ArrowDown" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();

    if (orderedNotes[0]) {
      focusRowByNoteId(orderedNotes[0].id);
    }
  }

  function ensureRowVisible(element) {
    const scroller = tableScrollYRef.current;

    if (!scroller) {
      return;
    }

    const headerBottom =
      scroller.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
    const scrollerBox = scroller.getBoundingClientRect();
    const rowBox = element.getBoundingClientRect();

    if (rowBox.top < headerBottom) {
      scroller.scrollTop -= headerBottom - rowBox.top;
    } else if (rowBox.bottom > scrollerBox.bottom) {
      scroller.scrollTop += rowBox.bottom - scrollerBox.bottom;
    }
  }

  function pinRowToTop(element) {
    const scroller = tableScrollYRef.current;

    if (!scroller) {
      return;
    }

    const headerBottom =
      scroller.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
    scroller.scrollTop += element.getBoundingClientRect().top - headerBottom;
  }

  function pageTable(direction) {
    const scroller = tableScrollYRef.current;

    if (!scroller || !orderedNotes.length) {
      return;
    }

    const headerHeight =
      scroller.querySelector("thead")?.offsetHeight ?? 0;
    const measuredRowHeight =
      scroller.querySelector("tbody tr.table-row-link")?.offsetHeight ??
      rowHeightEstimate;
    const pageSize = Math.max(
      1,
      Math.floor((scroller.clientHeight - headerHeight) / measuredRowHeight),
    );
    const currentIndex = orderedNotes.findIndex(
      (note) => note.id === focusedRowIdRef.current,
    );
    // No focus yet (fresh load, Esc to the anchor): anchor on the current
    // first visible row so the first press already jumps a full page.
    const firstVisibleIndex =
      rowVirtualizer.getVirtualItems()[0]?.index ?? 0;
    const baseIndex =
      currentIndex >= 0
        ? currentIndex
        : Math.min(Math.max(firstVisibleIndex, 0), orderedNotes.length - 1);
    const targetIndex = Math.min(
      Math.max(baseIndex + direction * pageSize, 0),
      orderedNotes.length - 1,
    );
    const target = orderedNotes[targetIndex];

    // focusRowByNoteId drives the scrolling (scrollToIndex for virtualized
    // rows, top-pin for mounted ones) so the target lands as the first row
    // below the sticky header. Never set scrollTop here: the previous
    // scroll-then-scan-DOM version read stale rows before the virtualizer
    // re-rendered and scrolled right back to where it started.
    if (target) {
      focusRowByNoteId(target.id, { pinToTop: true });
    }
  }

  function openEditor(noteId) {
    setActionError("");

    if (slideshowRouteActive) {
      navigateToTableRoute(
        slideshowRoute(noteId, {
          overlayEdit: true,
          previewKind: currentRoute.previewKind,
        }),
      );
      return;
    }

    navigateToTableRoute({ kind: "edit", noteId });
  }

  function openCreateNote() {
    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: null });
  }

  function openCreateNoteBefore(referenceNoteId) {
    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: referenceNoteId });
  }

  function openCreateNoteOverSlideshow(referenceNoteId) {
    setActionError("");
    navigateToTableRoute(
      slideshowRoute(referenceNoteId, { overlayCreate: true }),
    );
  }

  // Guarded exits share one prompt: navigating to another Note and closing
  // the editor both throw away whatever the form holds, so both ask the same
  // question. "Keep editing" is the default, and the copy names what is
  // about to be lost.
  function guardEditorExit(action) {
    if (confirmOpenRef.current) {
      return;
    }

    if (!editorDirtyRef.current) {
      action();
      return;
    }

    const route = currentRouteRef.current;
    const isCreate = isCreateRoute(route);
    requestConfirmation({
      title: isCreate ? "Discard new note?" : "Discard changes?",
      body: isCreate
        ? "Your new note will be lost."
        : "Your changes will be lost.",
      cancelLabel: "Keep editing",
      confirmLabel: "Discard",
    }).then((confirmed) => {
      if (confirmed) {
        action();
      }
    });
  }

  function jumpEditorToPosition(position) {
    const target = editorList[position - 1];

    if (!target) {
      return;
    }

    guardEditorExit(() => navigateToAdjacentEdit(target.id));
  }

  function editorCloseFocusNoteId() {
    // An edit shows the note it is acting on, including after stepping
    // through notes with the previous/next arrows. A create has no note of
    // its own, so it returns to the row the user was on. Either way, a
    // target that no longer exists (moved to another collection, filtered
    // out) falls back to the first row.
    const preferred = editingNoteId ?? lastRowFocusNoteIdRef.current;

    if (
      preferred != null &&
      orderedNotes.some((note) => note.id === preferred)
    ) {
      return preferred;
    }

    return orderedNotes[0]?.id ?? null;
  }

  function closeEditor() {
    editorDirtyRef.current = false;

    if (slideshowRouteActive) {
      navigateToTableRoute(
        slideshowRoute(currentRoute.noteId, {
          previewKind: currentRoute.previewKind,
        }),
        { replace: true },
      );
      return;
    }

    // The overlay is about to unmount, so the cursor has to be handed back
    // before it does: the rows stay mounted behind the overlay, so the
    // target row can be focused directly.
    const focusNoteId = editorCloseFocusNoteId();
    navigateToTableRoute(emptyTableRoute(), { replace: true });

    if (focusNoteId == null) {
      focusTableAnchor();
    } else {
      focusRowByNoteId(focusNoteId);
    }
  }

  closeEditorRef.current = closeEditor;

  function resetEditorOverlayScroll() {
    if (editorOverlayRef.current) {
      editorOverlayRef.current.scrollTop = 0;
    }
  }

  function navigateToAdjacentEdit(nextNoteId) {
    if (!nextNoteId) {
      return;
    }

    editorDirtyRef.current = false;

    if (slideshowRouteActive) {
      navigateToTableRoute(
        slideshowRoute(nextNoteId, {
          overlayEdit: true,
          previewKind: currentRoute.previewKind,
        }),
        { replace: true },
      );
      return;
    }

    navigateToTableRoute(
      { kind: "edit", noteId: nextNoteId },
      { replace: true },
    );
  }

  function showMoveToast(message) {
    setMoveToast(message);

    if (moveToastTimerRef.current) {
      clearTimeout(moveToastTimerRef.current);
    }

    moveToastTimerRef.current = setTimeout(() => setMoveToast(""), 4000);
  }

  function handleSaveEditedNote(
    updatedNote,
    reorderedNotes,
    movedToCollection,
    intent = "return",
  ) {
    editorDirtyRef.current = false;

    if (movedToCollection) {
      // The note now belongs to a different collection — it no longer
      // belongs in this view, so drop it instead of merging it in.
      setNotes((current) =>
        current.filter((note) => note.id !== updatedNote.id),
      );
      setSelectedIds((current) =>
        current.filter((id) => id !== updatedNote.id),
      );
      setSlideshowNotes((current) =>
        current.filter((note) => note.id !== updatedNote.id),
      );
      showMoveToast(`Moved to ${movedToCollection.name}.`);
    } else if (reorderedNotes) {
      setNotes(reorderedNotes);
      setSlideshowNotes((current) => {
        if (!current.length) {
          return current;
        }

        const slideshowIds = new Set(current.map((note) => note.id));
        return reorderedNotes.filter((note) => slideshowIds.has(note.id));
      });
    } else {
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
        if (!noteExists) return current;

        return current.map((note) =>
          note.id === updatedNote.id ? updatedNote : note,
        );
      });
    }

    // Save and stay keeps the editor open on the saved Note: a create
    // switches into edit mode on the Note it just made, rather than clearing
    // the form, so another Note is one "Add" away.
    if (intent === "stay" && !movedToCollection) {
      if (slideshowRouteActive) {
        navigateToTableRoute(
          slideshowRoute(updatedNote.id, {
            overlayEdit: true,
            previewKind: currentRoute.previewKind,
          }),
          { replace: true },
        );
      } else {
        navigateToTableRoute(
          { kind: "edit", noteId: updatedNote.id },
          { replace: true },
        );
      }
      return;
    }

    if (!movedToCollection && slideshowRouteActive) {
      navigateToTableRoute(
        slideshowRoute(updatedNote.id, {
          previewKind: currentRoute.previewKind,
        }),
        { replace: true },
      );
      return;
    }

    // A saved note is the row to return to: a create appends it, an edit
    // replaces it in place (possibly at a new sort position). When the save
    // took the note out of this view — moved to another collection, or it
    // fell out of the filter — the request is dropped, unless it emptied the
    // view, in which case the deferred focus falls back to the anchor.
    deferredRowFocusNoteIdRef.current = updatedNote.id;

    navigateToTableRoute(emptyTableRoute(), { replace: true });
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
    const scroller = tableScrollYRef.current;

    if (!shell || !scroller || draggedNoteId === null) {
      return;
    }

    const bounds = shell.getBoundingClientRect();
    const threshold = 56;
    const maxStep = 24;

    if (event.clientY < bounds.top + threshold) {
      const ratio = (bounds.top + threshold - event.clientY) / threshold;
      scroller.scrollTop -= Math.ceil(maxStep * Math.min(1, ratio));
    } else if (event.clientY > bounds.bottom - threshold) {
      const ratio = (event.clientY - (bounds.bottom - threshold)) / threshold;
      scroller.scrollTop += Math.ceil(maxStep * Math.min(1, ratio));
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
    // Land the keyboard cursor on the moved row in its new place. The row
    // keeps its key, so React moves the same DOM node and focus follows it
    // there.
    focusRowByNoteId(draggedNoteId);

    try {
      const payload = await saveNotesOrder(
        reorderedNotes.map((note) => note.id),
        activeCollectionId,
      );
      setNotes(payload.notes);
    } catch (reorderError) {
      setActionError(reorderError.message);
      setNotes(previousNotes);
    } finally {
      setReorderLoading(false);
    }
  }

  async function handleBulkDelete() {
    if (!selectedIds.length || bulkLoading) {
      return;
    }

    setActionError("");
    setBulkLoading(true);

    try {
      const confirmed = await requestConfirmation({
        title: `Delete ${selectedIds.length} selected note${selectedIds.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
      });

      if (!confirmed) {
        return;
      }

      // Land the cursor where the selection started: the row that takes
      // the topmost deleted slot, or the new last row when the selection
      // ran to the end.
      const removal = deleteFocusAfterRemoval(orderedNotes, selectedIds);

      await Promise.all(
        selectedIds.map((id) => deleteNote(id, activeCollectionId)),
      );
      // Request the landing focus before the refetch sets the list, so the
      // request can never be flushed after the render it belongs to.
      landFocusAfterDelete(removal);
      await loadNotes();
      clearSelection();
    } catch (actionError) {
      // A failed bulk action must not leave a focus request behind for the
      // next list change to pick up.
      deferredRowFocusNoteIdRef.current = null;
      setActionError(actionError.message);
    } finally {
      setBulkLoading(false);
    }
  }

  async function handleDeleteNote(noteId, { fromSlideshow = false } = {}) {
    const note = notes.find((entry) => entry.id === noteId);
    const noteLabel = note?.denomination || `note #${noteId}`;
    const confirmed = await requestConfirmation({
      title: `Delete ${noteLabel}?`,
      confirmLabel: "Delete",
    });

    if (!confirmed) {
      return false;
    }

    setActionError("");

    // Work out where the screen lands before the note leaves the list: for the
    // Table, the row that slips into the deleted note's slot (or the new last
    // row when the deleted note was last); for the slideshow, the note that
    // takes its place.
    const removal = fromSlideshow
      ? null
      : deleteFocusAfterRemoval(orderedNotes, [noteId]);
    const slideshowLanding = fromSlideshow
      ? slideshowLandingNoteId(slideshowNotes, noteId)
      : undefined;

    try {
      await deleteNote(noteId, activeCollectionId);

      if (fromSlideshow) {
        // The route-sync effect is the single place that reacts to a route
        // whose note has left the list, so record the landing intent and let
        // it move the slideshow on rather than race it with a second route
        // write here.
        pendingSlideshowLandingRef.current = {
          removedId: noteId,
          landingId: slideshowLanding,
        };
      }

      setNotes((current) => current.filter((entry) => entry.id !== noteId));
      setSelectedIds((current) => current.filter((id) => id !== noteId));
      setSlideshowNotes((current) =>
        current.filter((entry) => entry.id !== noteId),
      );

      if (!fromSlideshow) {
        landFocusAfterDelete(removal);
      }

      return true;
    } catch (deleteError) {
      setActionError(deleteError.message);
      return false;
    }
  }

  // The editor's Delete removes the note it is showing. The landing is owned by
  // handleDeleteNote: it records the intended slide and lets the route-sync
  // effect move there, so the delete never races the effect with a second
  // route write.
  async function handleDeleteEditingNote() {
    if (editingNoteId == null) {
      return;
    }

    // Clear the dirty flag for the hand-off so closing the editor cannot trip
    // the discard guard; restore it if the delete is cancelled or fails.
    const wasDirty = editorDirtyRef.current;
    editorDirtyRef.current = false;

    const deleted = await handleDeleteNote(editingNoteId, {
      fromSlideshow: slideshowRouteActive,
    });

    if (!deleted) {
      editorDirtyRef.current = wasDirty;
    }
  }

  // The editor's Add before opens create mode positioned ahead of the note
  // being edited, in whichever screen the editor was opened over. Opening the
  // form discards unsaved changes, so it goes through the same guard as the
  // other exits.
  function handleAddBeforeEditingNote() {
    if (editingNoteId == null) {
      return;
    }

    guardEditorExit(() => {
      if (slideshowRouteActive) {
        openCreateNoteOverSlideshow(editingNoteId);
        return;
      }

      openCreateNoteBefore(editingNoteId);
    });
  }

  async function handleCopyNoteDetails(note) {
    try {
      await copyTextToClipboard(formatNoteAsTsvRow(note));
      setActionError("");
    } catch {
      setActionError("Could not copy note details to clipboard.");
    }
  }

  function changeSlideshowIndex(updater) {
    if (!slideshowNotes.length || !slideshowRouteActive) {
      return;
    }

    const currentIndexValue = slideshowNotes.findIndex(
      (note) => note.id === currentRoute.noteId,
    );
    const resolvedIndex =
      typeof updater === "function" ? updater(currentIndexValue) : updater;
    const boundedIndex =
      ((resolvedIndex % slideshowNotes.length) + slideshowNotes.length) %
      slideshowNotes.length;
    const nextNote = slideshowNotes[boundedIndex];

    if (!nextNote) {
      return;
    }

    navigateToTableRoute(slideshowRoute(nextNote.id));
  }

  function openPreview(noteId, previewKind) {
    if (!validPreviewKinds.has(previewKind)) {
      return;
    }

    navigateToTableRoute(slideshowRoute(noteId, { previewKind }));
  }

  function closePreview(noteId) {
    navigateToTableRoute(slideshowRoute(noteId), { replace: true });
  }

  function movePreview(offset) {
    if (
      !slideshowRouteActive ||
      !slideshowNotes.length ||
      !currentRoute.previewKind
    ) {
      return;
    }

    const direction = offset >= 0 ? 1 : -1;
    let nextNoteIndex = slideshowNotes.findIndex(
      (note) => note.id === currentRoute.noteId,
    );

    if (nextNoteIndex < 0) {
      return;
    }

    let nextItems = ["front", "back"].filter((kind) =>
      validPreviewKinds.has(kind),
    );
    let nextItemIndex = nextItems.findIndex(
      (kind) => kind === currentRoute.previewKind,
    );

    if (nextItemIndex < 0) {
      nextItemIndex = direction > 0 ? -1 : nextItems.length;
    }

    let remainingSteps = Math.abs(offset);

    while (remainingSteps > 0) {
      const candidateIndex = nextItemIndex + direction;

      if (candidateIndex >= 0 && candidateIndex < nextItems.length) {
        nextItemIndex = candidateIndex;
        remainingSteps -= 1;
        continue;
      }

      nextNoteIndex =
        (nextNoteIndex + direction + slideshowNotes.length) %
        slideshowNotes.length;
      nextItems = ["front", "back"];
      nextItemIndex = direction > 0 ? 0 : nextItems.length - 1;
      remainingSteps -= 1;
    }

    navigateToTableRoute(
      slideshowRoute(slideshowNotes[nextNoteIndex].id, {
        previewKind: nextItems[nextItemIndex],
      }),
    );
  }

  // The absolute sibling of movePreview: jump straight to the Nth page of the
  // preview sequence (front/back across every note), so the popover's counter
  // can be typed into. `position` is 1-based, matching how the counter reads.
  function jumpToPreview(position) {
    if (
      !slideshowRouteActive ||
      !slideshowNotes.length ||
      !currentRoute.previewKind
    ) {
      return;
    }

    const previewKinds = ["front", "back"].filter((kind) =>
      validPreviewKinds.has(kind),
    );
    const perNote = previewKinds.length;

    if (!perNote) {
      return;
    }

    const target = Math.min(
      Math.max(position, 1),
      slideshowNotes.length * perNote,
    );
    const nextNoteIndex = Math.floor((target - 1) / perNote);
    const nextItemIndex = (target - 1) % perNote;
    const nextNote = slideshowNotes[nextNoteIndex];

    if (!nextNote) {
      return;
    }

    navigateToTableRoute(
      slideshowRoute(nextNote.id, {
        previewKind: previewKinds[nextItemIndex],
      }),
    );
  }

  // The absolute sibling of movePreview: jump straight to the first or last
  // page of the same positional sequence, without counting steps. Returns
  // whether the preview moved, so its key handler only suppresses the key's
  // native behaviour when there was somewhere to go.
  function jumpPreview(edge) {
    if (
      !slideshowRouteActive ||
      !slideshowNotes.length ||
      !currentRoute.previewKind
    ) {
      return false;
    }

    const atStart = edge === "start";
    const nextNoteIndex = atStart ? 0 : slideshowNotes.length - 1;
    const nextKind = atStart ? "front" : "back";
    const nextNote = slideshowNotes[nextNoteIndex];

    if (
      nextNote.id === currentRoute.noteId &&
      nextKind === currentRoute.previewKind
    ) {
      return false;
    }

    navigateToTableRoute(
      slideshowRoute(nextNote.id, { previewKind: nextKind }),
    );

    return true;
  }

  return (
    <section className="screen-stack">
      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      {confirmDialog}

      {slideshowRouteActive && slideshowNotes.length && slideshowIndex >= 0 ? (
        <Slideshow
          currentIndex={slideshowIndex}
          keyboardDisabled={editorOverlayOpen}
          notes={slideshowNotes}
          onAdd={openCreateNoteOverSlideshow}
          onChangeIndex={changeSlideshowIndex}
          onClose={closeSlideshow}
          onCopy={setActionError}
          onEdit={openEditor}
          onJump={(position) => changeSlideshowIndex(position - 1)}
          onOpenPreview={openPreview}
          onClosePreview={closePreview}
          onMovePreview={movePreview}
          onJumpPreview={jumpToPreview}
          onPreviewEnd={() => jumpPreview("end")}
          onPreviewStart={() => jumpPreview("start")}
          previewKind={currentRoute.previewKind}
        />
      ) : null}

      {editorOverlayOpen ? (
        <section className="edit-note-overlay" ref={editorOverlayRef}>
          <div
            className="edit-note-overlay-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <NoteEditForm
              selectedCollectionId={activeCollectionId}
              cancelLabel="Close"
              currentNotePosition={currentEditingNotePosition}
              initialPositionMode={createPositionMode}
              initialPositionReferenceId={createPositionReferenceId}
              nextNoteId={nextEditingNoteId}
              noteId={editingNoteId}
              onAddBefore={handleAddBeforeEditingNote}
              onCancel={() => guardEditorExit(() => closeEditorRef.current?.())}
              onDelete={handleDeleteEditingNote}
              onDirtyChange={handleEditorDirtyChange}
              onJumpToPosition={jumpEditorToPosition}
              onNavigateNext={() =>
                guardEditorExit(() => navigateToAdjacentEdit(nextEditingNoteId))
              }
              onNavigatePrevious={() =>
                guardEditorExit(() =>
                  navigateToAdjacentEdit(previousEditingNoteId),
                )
              }
              onReady={resetEditorOverlayScroll}
              onSaveSuccess={handleSaveEditedNote}
              overlay
              previousNoteId={previousEditingNoteId}
              shortcutsDisabled={confirmOpen}
              totalNotesInView={totalNotesInEditorList}
            />
          </div>
        </section>
      ) : null}

      <div className="panel" inert={editorOverlayOpen}>
        <div className="panel-heading panel-heading--compact">
          <div className="panel-heading-copy">
            <h2>Note Harbor Editor</h2>
            <p>
              Collection:{" "}
              <strong>
                {Number(activeCollection?.is_default) === 1 ? "★ " : ""}
                {activeCollection?.name ?? "-"}
              </strong>
              . {orderedNotes.length} notes in the current view.
              {showSelection && selectedIds.length
                ? ` ${selectedIds.length} selected.`
                : ""}
            </p>
          </div>
          <div className="inline-actions">
            {noCollections ? null : (
              <select
                aria-label="Active collection"
                className="select-input"
                disabled={loadingCollections || !collections.length}
                onChange={(event) =>
                  onSelectCollection(Number(event.target.value))
                }
                value={activeCollectionId ?? ""}
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {Number(collection.is_default) === 1 ? "★ " : ""}
                    {collection.name}
                  </option>
                ))}
              </select>
            )}
            <button
              aria-label="Add note"
              className="icon-link button-primary"
              data-shortcut="a"
              disabled={noCollections}
              onClick={openCreateNote}
              type="button"
            >
              Add note
            </button>
            <button
              aria-label="Keyboard shortcuts"
              className="icon-link"
              data-shortcut="?"
              onClick={() => setShowShortcutsHelp(true)}
              title="Keyboard shortcuts (?)"
              type="button"
            >
              Shortcuts
            </button>
          </div>
        </div>

        {loadingCollections ? <p>Loading collections...</p> : null}
        {loading ? <p>Loading notes...</p> : null}
        {collectionsError ? (
          <p className="error-text">{collectionsError}</p>
        ) : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {moveToast ? (
          <div className="scrape-toast scrape-toast--success" role="status">
            {moveToast}
          </div>
        ) : null}

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
              </div>
              <p className="table-helper-text">
                {reorderLoading
                  ? "Saving manual order..."
                  : canReorder
                    ? "Drag rows from the handle to change the default order."
                    : "Reordering is available only in the default unfiltered view."}{" "}
                Press <kbd>/</kbd> to filter, <kbd>&uarr;</kbd>/
                <kbd>&darr;</kbd> to browse rows, or <kbd>?</kbd> for shortcuts.
              </p>
              {selectedIds.length ? (
                <div className="inline-select-group inline-select-group--bulk">
                  <button
                    className="button button-primary"
                    disabled={bulkLoading}
                    onClick={handleBulkDelete}
                    type="button"
                  >
                    {bulkLoading ? "Working..." : "Delete selected"}
                  </button>
                </div>
              ) : null}
            </div>

            <div
              className="table-shell"
              onDragOver={autoScrollTableShell}
              ref={tableShellRef}
            >
              <span
                aria-hidden="true"
                className="table-focus-anchor"
                ref={tableFocusAnchorRef}
                tabIndex={-1}
              />
              <div
                className={`table-scroll-x${columnsDragging ? " is-panning" : ""}`}
                onClickCapture={handleColumnPanClickCapture}
                onLostPointerCapture={handleColumnPanPointerEnd}
                onMouseDown={handleColumnPanMouseDown}
                onPointerCancel={handleColumnPanPointerEnd}
                onPointerDown={handleColumnPanPointerDown}
                onPointerMove={handleColumnPanPointerMove}
                onPointerUp={handleColumnPanPointerEnd}
                ref={tableScrollXRef}
              >
                <div className="table-scroll-y" ref={tableScrollYRef}>
                  <table aria-busy={rowsPending || undefined}>
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
                        <th>
                          <button
                            className={`sort-button${sortKey === "id" ? " sort-button--active" : ""}`}
                            onClick={() => toggleSort("id")}
                            type="button"
                          >
                            ID
                            {sortKey === "id" ? (
                              <span>
                                {sortDirection === "asc" ? " ▲" : " ▼"}
                              </span>
                            ) : null}
                          </button>
                        </th>
                        <th>FRONT</th>
                        {visibleColumns.map(([key, label]) => (
                          <th
                            className={
                              key === "tags" ? "tags-column" : undefined
                            }
                            key={key}
                          >
                            <button
                              className={`sort-button${sortKey === key ? " sort-button--active" : ""}`}
                              onClick={() => toggleSort(key)}
                              type="button"
                            >
                              {label.toUpperCase()}
                              {sortKey === key ? (
                                <span>
                                  {sortDirection === "asc" ? " ▲" : " ▼"}
                                </span>
                              ) : null}
                            </button>
                          </th>
                        ))}
                        {showActions ? <th>ACTIONS</th> : null}
                        {vScroll.visible ? (
                          <th
                            aria-hidden="true"
                            className="table-gutter-cell"
                          />
                        ) : null}
                      </tr>
                      <tr>
                        {showReorder ? <th className="drag-cell" /> : null}
                        {showSelection ? <th /> : null}
                        <th />
                        <th />
                        {visibleColumns.map(([key, label]) => {
                          const isTagsColumn = key === "tags";

                          return (
                            <th
                              className={isTagsColumn ? "tags-column" : undefined}
                              key={`${key}-filter`}
                            >
                              {isTagsColumn ? (
                                <MultiValueFilterCombobox
                                  columnLabel={label}
                                  onChange={(nextValue) =>
                                    setFilters((current) => ({
                                      ...current,
                                      [key]: nextValue,
                                    }))
                                  }
                                  onArrowDown={handleFilterArrowDown}
                                  onFocus={() => rememberFilter(key)}
                                  onHeightChange={(height) =>
                                    reportColumnFilterHeight(key, height)
                                  }
                                  options={allTagNames}
                                  ref={getFilterRef(key)}
                                  value={filters[key] ?? ""}
                                />
                              ) : (
                                <input
                                  aria-label={`Filter ${label}`}
                                  className={`filter-input${String(filters[key] ?? "").trim() ? " filter-input--active" : ""}`}
                                  ref={getFilterRef(key)}
                                  onFocus={() => rememberFilter(key)}
                                  style={
                                    filterRowHeight
                                      ? { height: filterRowHeight }
                                      : undefined
                                  }
                                  value={filters[key] ?? ""}
                                  onChange={(event) =>
                                    setFilters((current) => ({
                                      ...current,
                                      [key]: event.target.value,
                                    }))
                                  }
                                  onKeyDown={handleFilterArrowDown}
                                />
                              )}
                            </th>
                          );
                        })}
                        {showActions ? <th /> : null}
                        {vScroll.visible ? (
                          <th
                            aria-hidden="true"
                            className="table-gutter-cell"
                          />
                        ) : null}
                      </tr>
                    </thead>
                    <tbody
                      onDragOver={(event) => {
                        if (!canReorder || draggedNoteId === null) {
                          return;
                        }

                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (
                          event.defaultPrevented ||
                          !canReorder ||
                          draggedNoteId === null ||
                          !dropTarget
                        ) {
                          return;
                        }

                        event.preventDefault();
                        void handleReorder(
                          dropTarget.noteId,
                          dropTarget.placement,
                        );
                      }}
                    >
                      {topSpacerHeight ? (
                        <tr aria-hidden="true" className="table-spacer-row">
                          <td
                            colSpan={totalColumnCount}
                            style={{ height: topSpacerHeight }}
                          />
                        </tr>
                      ) : null}
                      {!orderedNotes.length ? (
                        <tr className="table-empty-row">
                          <td
                            className="table-empty-cell"
                            colSpan={totalColumnCount}
                          >
                            {noCollections ? (
                              <NoCollectionsPrompt />
                            ) : notes.length ? (
                              "No notes match the current view."
                            ) : (
                              "No notes are stored yet. Use Import / Export to import data or add your first banknote."
                            )}
                          </td>
                        </tr>
                      ) : null}
                      {virtualRows.map((virtualRow) => {
                        const note = deferredOrderedNotes[virtualRow.index];
                        const displayImage = pickFirstAvailableImage(note, [
                          ["front", "thumbnail"],
                          ["front", "full"],
                          ["back", "thumbnail"],
                          ["back", "full"],
                        ]);
                        const frontThumb = displayImage?.path ?? null;
                        const frontPreview = displayImage?.path ?? null;
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
                              className={`table-row-link${virtualRow.index % 2 === 1 ? " table-row-link--zebra" : ""}${draggedNoteId === note.id ? " table-row-link--dragging" : ""}${activeNoteId === note.id ? " table-row-link--active" : ""}`}
                              data-index={virtualRow.index}
                              key={note.id}
                              ref={(element) => {
                                if (element) {
                                  rowElementMapRef.current.set(
                                    note.id,
                                    element,
                                  );
                                  rowVirtualizer.measureElement(element);

                                  if (
                                    pendingRowFocusNoteIdRef.current === note.id
                                  ) {
                                    pendingRowFocusNoteIdRef.current = null;
                                    element.focus({ preventScroll: true });
                                    focusedRowIdRef.current = note.id;
                                    setActiveNoteId(note.id);
                                    ensureRowVisible(element);
                                  } else if (
                                    focusedRowIdRef.current === note.id &&
                                    document.activeElement === document.body
                                  ) {
                                    // The active row was scrolled out of the
                                    // virtualized window (unmounting drops
                                    // focus to <body> with no blur event) and
                                    // has now remounted: reclaim focus without
                                    // scrolling, since the user put it here.
                                    element.focus({ preventScroll: true });
                                  }
                                } else {
                                  rowElementMapRef.current.delete(note.id);
                                }
                              }}
                              onMouseDown={() => {
                                mouseFocusSuppressRef.current = true;
                              }}
                              onMouseUp={() => {
                                mouseFocusSuppressRef.current = false;
                              }}
                              onFocus={() => {
                                focusedRowIdRef.current = note.id;
                                lastRowFocusNoteIdRef.current = note.id;

                                if (mouseFocusSuppressRef.current) {
                                  mouseFocusSuppressRef.current = false;
                                } else {
                                  setActiveNoteId(note.id);
                                }
                              }}
                              onBlur={(event) => {
                                if (
                                  !event.currentTarget.contains(
                                    event.relatedTarget,
                                  )
                                ) {
                                  focusedRowIdRef.current =
                                    focusedRowIdRef.current === note.id
                                      ? null
                                      : focusedRowIdRef.current;
                                  setActiveNoteId((current) =>
                                    current === note.id ? null : current,
                                  );
                                }
                              }}
                              onDragLeave={(event) => {
                                // The drop placeholder is a sibling row
                                // inserted into this same tbody, so moving
                                // the pointer onto it (or onto a neighbouring
                                // row) must not clear the target. Clearing it
                                // would unmount the placeholder, drop the
                                // pointer back on this row, and re-insert the
                                // placeholder — a loop that makes the rows
                                // flicker. Only a move that leaves the body
                                // entirely clears the target.
                                const body =
                                  event.currentTarget.closest("tbody");

                                if (
                                  event.relatedTarget &&
                                  body?.contains(event.relatedTarget)
                                ) {
                                  return;
                                }

                                setDropTarget((current) =>
                                  current?.noteId === note.id
                                    ? null
                                    : current,
                                );
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
                                // Only the row itself opens the note. Tab can
                                // move focus onto a control inside the row
                                // (drag handle, checkbox, denomination link,
                                // action buttons), and those must activate
                                // themselves instead of the row swallowing
                                // Enter/Space as it bubbles up.
                                if (event.target !== event.currentTarget) {
                                  return;
                                }

                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
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
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      onDragEnd={clearDragState}
                                      onDragStart={(event) => {
                                        const row =
                                          rowElementMapRef.current.get(note.id);

                                        clearDragPreview();
                                        event.stopPropagation();
                                        event.dataTransfer.effectAllowed =
                                          "move";
                                        event.dataTransfer.setData(
                                          "text/plain",
                                          String(note.id),
                                        );

                                        if (row) {
                                          const preview = row.cloneNode(true);
                                          preview.classList.add(
                                            "table-drag-preview",
                                          );
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
                                <td
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    aria-label={`Select ${note.denomination}`}
                                    checked={selectedIdSet.has(note.id)}
                                    onChange={() => toggleNote(note.id)}
                                    type="checkbox"
                                  />
                                </td>
                              ) : null}
                              <td>{note.display_order ?? "-"}</td>
                              <td>
                                {frontThumb ? (
                                  <span
                                    className="table-thumb-wrap"
                                    onBlur={(event) => {
                                      if (
                                        !event.currentTarget.contains(
                                          event.relatedTarget,
                                        )
                                      ) {
                                        hideThumbPreview(note.id);
                                      }
                                    }}
                                    onFocus={() => showThumbPreview(note.id)}
                                    onMouseEnter={() =>
                                      showThumbPreview(note.id)
                                    }
                                    onMouseLeave={() =>
                                      hideThumbPreview(note.id)
                                    }
                                    ref={(element) => {
                                      if (element) {
                                        thumbPreviewElementMapRef.current.set(
                                          note.id,
                                          element,
                                        );
                                      } else {
                                        thumbPreviewElementMapRef.current.delete(
                                          note.id,
                                        );
                                      }
                                    }}
                                  >
                                    <img
                                      alt={`${note.denomination} front`}
                                      className="table-thumb"
                                      decoding="async"
                                      loading="lazy"
                                      src={frontThumb}
                                    />
                                    {frontPreview ? (
                                      <span
                                        className={`table-thumb-preview${
                                          thumbPreviewState?.noteId === note.id
                                            ? " is-visible"
                                            : ""
                                        }`}
                                        style={{
                                          "--table-thumb-preview-offset": `${
                                            thumbPreviewState?.noteId ===
                                            note.id
                                              ? thumbPreviewState.offsetY
                                              : 0
                                          }px`,
                                        }}
                                      >
                                        {thumbPreviewState?.noteId ===
                                        note.id ? (
                                          <img
                                            alt={`${note.denomination} preview`}
                                            src={frontPreview}
                                          />
                                        ) : null}
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
                                    draggable={false}
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
                              <td className="tags-column">
                                <TagsCell
                                  onApplyFilter={applyTagFilter}
                                  tags={note.tags}
                                />
                              </td>
                              {showActions ? (
                                <td>
                                  <div className="inline-actions">
                                    <button
                                      className="icon-link"
                                      data-shortcut="c"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleCopyNoteDetails(note);
                                      }}
                                      type="button"
                                      aria-label={`Copy ${note.denomination || `note ${note.id}`}`}
                                    >
                                      <svg
                                        aria-hidden="true"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        width="16"
                                      >
                                        <rect
                                          fill="none"
                                          height="10"
                                          rx="2"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          width="10"
                                          x="9"
                                          y="9"
                                        />
                                        <rect
                                          fill="none"
                                          height="10"
                                          rx="2"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          width="10"
                                          x="5"
                                          y="5"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      className="icon-link"
                                      data-shortcut="a"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openCreateNoteBefore(note.id);
                                      }}
                                      type="button"
                                      aria-label={`Insert note before ${note.denomination || `note ${note.id}`}`}
                                    >
                                      <svg
                                        aria-hidden="true"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        width="16"
                                      >
                                        <path
                                          d="M12 5v14"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                        <path
                                          d="M5 12h14"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      className="icon-link"
                                      data-shortcut="e"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openEditor(note.id);
                                      }}
                                      type="button"
                                      aria-label={`Edit ${note.denomination || `note ${note.id}`}`}
                                    >
                                      <svg
                                        aria-hidden="true"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        width="16"
                                      >
                                        <path
                                          d="M4 20h4l10-10-4-4L4 16v4z"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                        <path
                                          d="M12 6l4 4"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                      </svg>
                                    </button>
                                    <button
                                      className="icon-link"
                                      data-shortcut="d"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleDeleteNote(note.id);
                                      }}
                                      type="button"
                                      aria-label={`Delete ${note.denomination || `note ${note.id}`}`}
                                    >
                                      <svg
                                        aria-hidden="true"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        width="16"
                                      >
                                        <path
                                          d="M5 7h14"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                        <path
                                          d="M9 7V5h6v2"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                        <path
                                          d="M8 7l1 12h6l1-12"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        />
                                      </svg>
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
                          <td
                            colSpan={totalColumnCount}
                            style={{ height: bottomSpacerHeight }}
                          />
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </div>
              {vScroll.visible ? (
                <div
                  className="table-vtrack"
                  onPointerDown={handleVTrackPointerDown}
                  style={{ bottom: vScroll.bottom, top: vScroll.top }}
                >
                  <button
                    aria-label="Scroll notes table vertically"
                    aria-orientation="vertical"
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={vScroll.valueNow}
                    className="table-vthumb"
                    onKeyDown={handleVThumbKeyDown}
                    onPointerCancel={handleVThumbPointerEnd}
                    onPointerDown={handleVThumbPointerDown}
                    onPointerMove={handleVThumbPointerMove}
                    onPointerUp={handleVThumbPointerEnd}
                    role="scrollbar"
                    style={{
                      height: vScroll.thumbHeight,
                      transform: `translateY(${vScroll.thumbTop}px)`,
                    }}
                    type="button"
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export { NotesTable };
