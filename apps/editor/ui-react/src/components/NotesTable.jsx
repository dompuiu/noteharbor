import {
  Fragment,
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
import { Link, useLocation, useNavigate } from "react-router-dom";
import { CATALOG_ROUTES } from "../lib/routes.js";
import {
  deleteNote,
  getNotes,
  reorderNotes as saveNotesOrder,
} from "../lib/api.js";
import {
  copyTextToClipboard,
  formatNoteAsTsvRow,
} from "../lib/noteClipboard.js";
import {
  isEditableElement,
  MODAL_SURFACE_SELECTOR,
} from "../lib/editableElement.js";
import { isEmptyLibrary } from "../lib/libraryState.js";
import {
  clearLegacyTableState,
  defaultTableState,
  keepsADataColumn,
  loadTableState,
  pruneTableStates,
  saveTableState,
} from "../lib/notesTableState.js";
import { shouldHandOffToFilters } from "../lib/filterFocusMemory.js";
import {
  COLUMN_PAN_THRESHOLD_PX,
  COLUMN_SCROLL_STEP,
  clampColumnScrollLeft,
  columnPanScrollLeft,
  isColumnPanShadowVisible,
  isColumnPanTarget,
} from "../lib/tableColumnPan.js";
import {
  columnSearchMatches,
  dataColumns,
  defaultSortKey,
  getTableColumn,
  hideableColumnKeys,
  hideableColumns,
  hideableDataColumns,
  lastStickyKey,
  matchesSearchQuery,
  parseGradeValue,
  slideshowFilterKeys,
  stickyOffsets,
  tableColumns,
  tableColumnWidths,
  tagsColumnKey,
  validSortKeys,
} from "../lib/tableColumns.js";
import { ColumnPicker } from "./ColumnPicker.jsx";
import { FilterFieldMenu } from "./FilterFieldMenu.jsx";
import { HighlightMatch, rankTagSuggestions } from "./TagsField.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { NoCollectionsPrompt } from "./NoCollectionsPrompt.jsx";
import { RowActionsMenu } from "./RowActionsMenu.jsx";
import { Slideshow } from "./Slideshow.jsx";

export function HomeHero() {
  return null;
}

const rowHeightEstimate = 46;
// Mirrors the table's CSS min-width and the trailing scrollbar-gutter column.
const minTableWidth = 1200;
const tableGutterWidth = 14;
const validPreviewKinds = new Set(["front", "back"]);
const slideshowFilterParamPrefix = "f_";
// Shared by the rendered tags and the hidden-tag measurer below, so the probe
// can never drift from the tag it is measuring.
const tableTagClass = "tag table-tag";
const tagChipHorizontalPadding = 16;
const tagMoreChipHorizontalPadding = 14;
const tagListGap = 5;
const tagChipMeasureSafetyMargin = 2;
const tagsPopoverWidth = 280;
const tagsPopoverMaxHeight = 320;
const tagsPopoverOpenDelay = 300;
const tagsPopoverCloseDelay = 150;

let tagTextMeasureContext = null;

// Alignment travels with the column model (`align`: text left, display order
// right, selection/thumbnail/actions centered) and is emitted as a class on
// every header and body cell. The stylesheet owns the actual text-align, so
// hidden and reordered columns cannot drift out of alignment.
function alignmentClass(column) {
  return `align-${column?.align ?? "left"}`;
}

// Header and body cells build their classes from the same column model, so a
// compact column keeps one content box and one alignment in both places.
function cellClass(column) {
  return [
    alignmentClass(column),
    column.key ? `table-col-${column.key}` : null,
    column.kind === "reorder" ? "drag-cell" : null,
    column.kind === "order" ? "table-order-cell" : null,
    column.kind === "thumbnail" ? "table-thumb-cell" : null,
    column.kind === "actions" ? "table-actions-cell" : null,
    column.isTags ? "tags-column" : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function getTagTextMeasureContext() {
  if (tagTextMeasureContext || typeof document === "undefined") {
    return tagTextMeasureContext;
  }

  const probe = document.createElement("button");
  probe.className = tableTagClass;
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

function measureTagChipWidth(
  text,
  horizontalPadding = tagChipHorizontalPadding,
) {
  const context = getTagTextMeasureContext();

  if (!context) {
    return text.length * 8 + horizontalPadding;
  }

  return (
    Math.ceil(context.measureText(text).width) +
    horizontalPadding +
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
    let width = measureTagChipWidth(
      `+${hiddenCount}`,
      tagMoreChipHorizontalPadding,
    );

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
          className={tableTagClass}
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
            className={`${tableTagClass} table-tag--more`}
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
                      className={tableTagClass}
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

// A slideshow URL that carries sort context owns the sort for the render it
// opens on; a plain visit uses the collection's saved structure.
function initialTableView(collectionId, route) {
  const savedState = loadTableState(collectionId);

  if (route?.kind !== "slideshow") {
    return savedState;
  }

  const routeSortKey = route.slideshowSortKey;
  const routeSortDirection = route.slideshowSortDirection;

  return {
    ...savedState,
    sortKey:
      routeSortKey && validSortKeys.has(routeSortKey)
        ? routeSortKey
        : savedState.sortKey,
    sortDirection:
      routeSortDirection === "asc" || routeSortDirection === "desc"
        ? routeSortDirection
        : savedState.sortDirection,
  };
}

function valueToString(note, key) {
  if (getTableColumn(key)?.isTags) {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Marks the terms a row matched, so a result set explains itself instead of
// leaving the collector to guess which field matched.
function highlightTerms(text, terms) {
  const raw = String(text ?? "");
  const needles = [
    ...new Set((terms ?? []).filter(Boolean).map((term) => String(term))),
  ].sort((left, right) => right.length - left.length);

  if (!needles.length) {
    return raw;
  }

  const pattern = new RegExp(`(${needles.map(escapeRegExp).join("|")})`, "gi");
  const parts = raw.split(pattern);

  if (parts.length === 1) {
    return raw;
  }

  return parts.map((part, index) =>
    index % 2 === 1 ? <mark key={index}>{part}</mark> : part,
  );
}

// How a note names itself outside the table. A denomination alone is not an
// identity — a collection holds three notes called "1 Leu" — so the catalog
// number leads and the row is disambiguated by the same fields the table
// shows: company, grade, serial, date. Every destructive control reads this,
// never `note.denomination`.
function noteDisplayName(note) {
  const catalog = String(note?.catalog_number ?? "").trim();
  const denomination = String(note?.denomination ?? "").trim();
  const name = [catalog, denomination].filter(Boolean).join(" · ");

  return name || `Note ${note?.id ?? ""}`.replace(/\s+$/, "");
}

function noteIdentityDetails(note) {
  return [
    note?.grading_company,
    note?.grade,
    note?.serial ? `serial ${note.serial}` : null,
    note?.issue_date,
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}

function noteThumbPath(note) {
  return (
    pickFirstAvailableImage(note, [
      ["front", "thumbnail"],
      ["front", "full"],
      ["back", "thumbnail"],
      ["back", "full"],
    ])?.path ?? null
  );
}

// ── Filter chips ───────────────────────────────────────────────────
// One chip is one condition: a field, a value, and whether it is excluded.
// Same field ORs, different fields AND (see filterNotesByConditions).

const defaultFilterField = "catalog_number";

const filterFieldLabels = {
  all: "All fields",
  catalog_number: "Catalog",
  denomination: "Denomination",
  issue_date: "Date",
  grading_company: "Company",
  grade: "Grade",
  serial: "Serial",
  tags: "Tags",
};

function filterFieldLabel(field) {
  return filterFieldLabels[field] ?? "All fields";
}

let conditionSeq = 0;

function makeCondition(field, value, negated = false) {
  conditionSeq += 1;
  return { id: `filter-${conditionSeq}`, field, value, negated };
}

function conditionIdentity(condition) {
  return `${condition.field}:${condition.negated ? "!" : ""}${condition.value.toLowerCase()}`;
}

// One committed input may carry several values (`22, 19`) and a negation
// (`!PMG`); each becomes its own chip so the row states exactly what it means.
function conditionsFromInput(field, raw) {
  const parsed = [];

  for (const token of String(raw ?? "").split(",")) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    const negated = trimmed.startsWith("!");
    const value = (negated ? trimmed.slice(1) : trimmed).trim();

    if (value) {
      parsed.push(makeCondition(field, value, negated));
    }
  }

  return parsed;
}

function serializeConditions(conditions) {
  return (conditions ?? [])
    .map(
      (condition) =>
        `${encodeURIComponent(condition.field)}:${condition.negated ? "!" : ""}${encodeURIComponent(condition.value)}`,
    )
    .join(";");
}

function parseConditionsParam(raw) {
  const parsed = [];

  for (const part of String(raw ?? "").split(";")) {
    const separator = part.indexOf(":");

    if (separator <= 0) {
      continue;
    }

    const field = decodeURIComponent(part.slice(0, separator));
    let value = part.slice(separator + 1);
    let negated = false;

    if (value.startsWith("!")) {
      negated = true;
      value = value.slice(1);
    }

    try {
      value = decodeURIComponent(value);
    } catch {
      continue;
    }

    if (value.trim()) {
      parsed.push(makeCondition(field, value.trim(), negated));
    }
  }

  return parsed;
}

// The table behind a cold-opened slideshow mirrors the URL's chip snapshot.
// Older links carry `f_<column>` filters and `q`; both still parse.
function conditionsFromRoute(route) {
  if (route?.kind !== "slideshow") {
    return [];
  }

  const parsed = [...(route.slideshowConditions ?? [])];

  for (const [key, raw] of Object.entries(route.slideshowFilters ?? {})) {
    parsed.push(...conditionsFromInput(key, raw));
  }

  if (route.slideshowQuery) {
    parsed.push(makeCondition("all", route.slideshowQuery));
  }

  return parsed;
}

// A chip editor should not offer a field the table no longer shows.
function isConditionVisible(condition, visibleColumnKeys) {
  return condition.field === "all" || visibleColumnKeys.includes(condition.field);
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

// Filter chips: one field, one value, optionally negated. Values inside a
// field are ORed; different fields are ANDed; a negation must not match.
function groupConditions(conditions) {
  const groups = new Map();

  for (const condition of conditions ?? []) {
    if (!groups.has(condition.field)) {
      groups.set(condition.field, []);
    }
    groups.get(condition.field).push(condition);
  }

  return groups;
}

function conditionMatches(note, condition, searchColumns) {
  if (condition.field === "all") {
    return matchesSearchQuery(note, condition.value, searchColumns);
  }

  const column = getTableColumn(condition.field);

  if (!column) {
    return true;
  }

  if (column.isTags) {
    return matchesTagFilter(note, condition.value);
  }

  return matchesFilterValue(
    valueToString(note, column.key),
    condition.value,
    column.matchMode,
    { multiple: false, normalizeFilterValue: column.normalize },
  );
}

function filterNotesByConditions(noteList, conditions, searchColumns) {
  if (!conditions?.length) {
    return noteList;
  }

  const groups = groupConditions(conditions);

  return noteList.filter((note) => {
    for (const list of groups.values()) {
      const positives = list.filter((condition) => !condition.negated);

      if (
        positives.length &&
        !positives.some((condition) =>
          conditionMatches(note, condition, searchColumns),
        )
      ) {
        return false;
      }

      for (const condition of list) {
        if (
          condition.negated &&
          conditionMatches(note, condition, searchColumns)
        ) {
          return false;
        }
      }
    }

    return true;
  });
}

// Which columns each row matched, so the table can mark the terms instead of
// leaving the collector to guess why a row is there.
function marksForNote(note, conditions, searchColumns) {
  const marks = {};
  const add = (key, term) => {
    const list = marks[key] ?? (marks[key] = []);
    if (!list.includes(term)) {
      list.push(term);
    }
  };

  for (const condition of conditions ?? []) {
    if (condition.negated) {
      continue;
    }

    if (!conditionMatches(note, condition, searchColumns)) {
      continue;
    }

    if (condition.field === "all") {
      const terms = String(condition.value)
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      for (const term of terms) {
        for (const column of searchColumns) {
          if (columnSearchMatches(note, column, term)) {
            add(column.key, term);
          }
        }
      }
    } else {
      add(condition.field, condition.value);
    }
  }

  return marks;
}

function sortNotesBySort(noteList, key, direction) {
  const sortKey = validSortKeys.has(key) ? key : defaultSortKey;
  const sortDirection = direction === "desc" ? "desc" : "asc";
  const sortValue = getTableColumn(sortKey)?.sortValue ?? null;
  return [...noteList].sort((left, right) => {
    if (sortKey === defaultSortKey) {
      const orderResult = noteOrderValue(left) - noteOrderValue(right);
      const result = orderResult || left.id - right.id;
      return sortDirection === "asc" ? result : -result;
    }

    const leftText = valueToString(left, sortKey).toLowerCase();
    const rightText = valueToString(right, sortKey).toLowerCase();
    // Ordering on the printed text is wrong the moment a column carries a
    // number or a date (`1917` vs `01/01/1917`, `1,000 Lei` vs `100 Lei`), so
    // a column that can be read declares its own comparable value.
    const leftValue = sortValue ? sortValue(left) : null;
    const rightValue = sortValue ? sortValue(right) : null;
    const leftMissing = leftValue == null || Number.isNaN(leftValue);
    const rightMissing = rightValue == null || Number.isNaN(rightValue);

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        // Both unreadable: fall back to the printed text, in the same
        // direction, so a column of free-form values still reverses.
        const result = rowSortCollator.compare(leftText, rightText);
        return sortDirection === "asc" ? result : -result;
      }

      // An unreadable value is an absence, not a smallest value: it sits at
      // the end in both directions instead of leading "sorted by date".
      return leftMissing ? 1 : -1;
    }

    const result =
      leftValue === rightValue
        ? rowSortCollator.compare(leftText, rightText)
        : leftValue - rightValue;
    return sortDirection === "asc" ? result : -result;
  });
}

function applyTableView(
  noteList,
  conditions,
  key,
  direction,
  searchColumns = dataColumns,
) {
  return sortNotesBySort(
    filterNotesByConditions(noteList, conditions, searchColumns),
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

// Drops `removedId` and closes the ID-column gap the same way the backend
// does (`display_order - 1 WHERE display_order > removed_order`), so the
// optimistic list never shows stale IDs while the refetch is skipped. A note
// without a `display_order` only filters, matching the backend's no-op.
function dropNoteAndRenumber(noteList, removedId) {
  const removed = noteList.find((note) => note.id === removedId);
  const removedOrder = removed?.display_order;

  const remaining = noteList.filter((note) => note.id !== removedId);

  if (removedOrder == null) {
    return remaining;
  }

  return remaining.map((note) =>
    note.display_order != null && note.display_order > removedOrder
      ? { ...note, display_order: note.display_order - 1 }
      : note,
  );
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
    afterId: null,
    beforeId: null,
    kind: "table",
    noteId: null,
    overlayCreate: false,
    overlayEdit: false,
    previewKind: null,
    slideshowCollectionId: null,
    slideshowConditions: null,
    slideshowFilters: null,
    slideshowQuery: null,
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
  return (
    (route.kind === "edit" || Boolean(route.overlayEdit)) &&
    !route.overlayCreate
  );
}

function hasSlideshowContext(route) {
  return Boolean(
    route &&
    route.kind === "slideshow" &&
    (route.slideshowCollectionId != null ||
      route.slideshowConditions != null ||
      route.slideshowFilters != null ||
      route.slideshowQuery != null ||
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
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "asc" || normalized === "desc") {
    return normalized;
  }
  return null;
}

function parseSlideshowQuery(value) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
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
      afterId: parsePositiveInteger(params.get("after")),
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
      slideshowConditions: params.has("fc")
        ? parseConditionsParam(params.get("fc"))
        : null,
      slideshowFilters: parseSlideshowFilters(params),
      slideshowQuery: parseSlideshowQuery(params.get("q")),
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

    if (route.afterId) {
      params.set("after", String(route.afterId));
    } else if (route.beforeId) {
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

    if (route.slideshowConditions) {
      params.set("fc", serializeConditions(route.slideshowConditions));
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
  collection,
  collectionId,
  collections,
  collectionsError,
  loadingCollections,
  isNewCollection = false,
  newCollectionName = "",
  onNewCollectionNameChange = null,
  onSaveNewCollection = null,
  onCancelNewCollection = null,
  savingNewCollection = false,
  newCollectionError = "",
  showEditCollectionAction = true,
  isCollectionEditing = false,
  collectionEditName = "",
  onCollectionEditNameChange = null,
  onCollectionEditNameBlur = null,
  onCollectionEditNameKeyDown = null,
  collectionEditFieldRef = null,
  collectionEditError = "",
  onSaveCollectionEdit = null,
  onCancelCollectionEdit = null,
  onDeleteCollectionEdit = null,
  savingCollectionEdit = false,
  deletingCollectionEdit = false,
  canSaveCollectionEdit = false,
  collectionEditDialog = null,
}) {
  const initialRouteRef = useRef(
    typeof window === "undefined"
      ? emptyTableRoute()
      : parseTableHash(window.location.hash),
  );
  const rowElementMapRef = useRef(new Map());
  const rowActionsMenuMapRef = useRef(new Map());
  const thumbPreviewElementMapRef = useRef(new Map());
  const dragPreviewRef = useRef(null);
  const tableScreenRef = useRef(null);
  const tableShellRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(null);
  const columnPanRef = useRef(null);
  const suppressColumnPanClickRef = useRef(false);
  const vMetricsRef = useRef({ max: 0, range: 0, thumbHeight: 0 });
  const vThumbDragRef = useRef(null);
  const editorOverlayRef = useRef(null);
  const focusedRowIdRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
  const searchInputRef = useRef(null);
  const tagSuggestionListRef = useRef(null);
  const currentRouteRef = useRef(null);
  const pendingRowFocusNoteIdRef = useRef(null);
  // Tab from a row enters the selection actions bar before the row's own
  // controls; Shift+Tab out of the bar's first item goes to the row's
  // actions button. These requests can only be honoured once a virtualized
  // row mounts, so they are held here like `pendingRowFocusNoteIdRef`.
  const pendingRowCheckboxFocusNoteIdRef = useRef(null);
  const pendingRowActionsFocusNoteIdRef = useRef(null);
  // The bar's own buttons come before the rows in the intended tab cycle
  // once a selection exists. The ref tracks whether the next Tab should
  // honour that, and the live selection size so the window-level handler
  // can read it without re-subscribing on every toggle.
  const selectionTabArmedRef = useRef(false);
  const selectedIdsRef = useRef([]);
  const userSelectionChangeRef = useRef(false);
  const prevHasSelectionRef = useRef(false);
  const pendingRowKeyboardFocusArmRef = useRef(null);
  const bulkBarRef = useRef(null);
  // A mouse-made selection leaves focus on a checkbox but paints no row
  // cursor. Escape drops that focus to the anchor, and this remembers the
  // row the next arrow press should paint so navigation resumes where the
  // pointer left off instead of jumping to the first row.
  const escapeResumeNoteIdRef = useRef(null);
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

  // Table structure — sort and visible columns — is one saved, per-collection
  // preference. Filters, search and selection are not: they are seeded from a
  // slideshow URL when it carries context and otherwise start empty.
  const [tableView, setTableView] = useState(() =>
    initialTableView(collectionId, initialRouteRef.current),
  );
  const [tableViewCollectionId, setTableViewCollectionId] =
    useState(collectionId);
  // The payload the table is currently showing, so the save effect can tell a
  // user change from a collection switch or the initial load.
  const savedTableViewRef = useRef({ collectionId, tableView });

  // A collection switch swaps in that collection's saved structure during the
  // same render, so no commit ever paints the previous collection's sort or
  // columns and the save effect cannot write them under the new id.
  if (tableViewCollectionId !== collectionId) {
    setTableViewCollectionId(collectionId);
    setTableView(loadTableState(collectionId));
  }

  const { sortDirection, sortKey, visibleColumnKeys } = tableView;

  // The All-fields chip searches only the columns the collector can see, so a
  // hidden column can never keep hiding rows.
  const searchColumns = useMemo(
    () =>
      dataColumns.filter(
        (column) =>
          !column.hideable || visibleColumnKeys.includes(column.key),
      ),
    [visibleColumnKeys],
  );

  useEffect(() => {
    // Drops saved settings from before the per-collection table state.
    clearLegacyTableState();
  }, []);

  useEffect(() => {
    // A deleted collection leaves nobody to read its saved table structure.
    if (loadingCollections || collectionsError || !Array.isArray(collections)) {
      return;
    }

    pruneTableStates(collections.map((collection) => collection.id));
  }, [collections, collectionsError, loadingCollections]);

  const [notes, setNotes] = useState([]);
  // Filter chips: view state only. A cold-opened slideshow URL carries the
  // chips so closing the slideshow returns to the same filtered table.
  const [conditions, setConditions] = useState(() =>
    conditionsFromRoute(initialRouteRef.current),
  );
  // Which field the next chip belongs to, and the text not yet committed.
  // The draft is kept when a chip is edited or removed, so half-typed text is
  // never lost to a chip action.
  const [filterField, setFilterField] = useState(defaultFilterField);
  const [filterDraft, setFilterDraft] = useState("");
  const [tagSuggestionOpen, setTagSuggestionOpen] = useState(false);
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);
  const [tagSuggestionPosition, setTagSuggestionPosition] = useState(null);
  const [editingConditionId, setEditingConditionId] = useState(null);
  const [conditionDraft, setConditionDraft] = useState("");
  // Selection is deliberately memory-only: restoring a stale bulk-delete
  // queue after a reload is worse than starting clean, and it leaves a bar
  // on screen with no row cursor to return to.
  const [selectedIds, setSelectedIds] = useState([]);
  useEffect(() => {
    // Arming is deliberately tied to user actions: the bar appearing and a
    // checkbox/select-all toggle. A background refresh that prunes deleted
    // rows must not make an unrelated Tab jump backwards to the bar.
    selectedIdsRef.current = selectedIds;
    const hasSelection = selectedIds.length > 0;

    if (!hasSelection) {
      selectionTabArmedRef.current = false;
    } else if (
      userSelectionChangeRef.current ||
      !prevHasSelectionRef.current
    ) {
      selectionTabArmedRef.current = true;
    }

    userSelectionChangeRef.current = false;
    prevHasSelectionRef.current = hasSelection;
  }, [selectedIds]);
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
  const [columnsScrolled, setColumnsScrolled] = useState(false);
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
  const collectionNameFieldRef = useRef(null);
  const {
    confirm: requestConfirmation,
    dialog: confirmDialog,
    isOpen: confirmOpen,
  } = useConfirmation();
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

  // A not-yet-saved collection has no view to rename: its header is the
  // draft form from the start, focused so the name can be typed at once.
  const showingNewCollectionForm = isNewCollection;
  useEffect(() => {
    if (!showingNewCollectionForm) {
      return;
    }

    const field = collectionNameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [showingNewCollectionForm]);

  function handleCollectionRenameSubmit(event) {
    event.preventDefault();
    void onSaveNewCollection?.();
  }

  function handleNewCollectionNameKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancelNewCollection?.();
    }
  }

  const showSelection = true;
  const showReorder = true;
  // An empty library is not an outage; a failed load keeps its inline
  // `collectionsError` instead.
  const noCollections = isEmptyLibrary({
    collections,
    collectionsError,
    loadingCollections,
  });
  // Tag names offered as suggestions when the Tags field is selected. The
  // chips still commit with Enter; the list only saves typing.
  const tagNames = useMemo(() => {
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

    return Array.from(seen.values()).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [notes]);

  const tagMatches = useMemo(
    () => rankTagSuggestions(tagNames, new Set(), filterDraft),
    [filterDraft, tagNames],
  );
  const trimmedTagDraft = filterDraft.trim();
  // The filter only suggests tags that some note already carries. Creating a
  // tag belongs to the note editor, so the filter list has no create arm.
  const tagListVisible =
    filterField === tagsColumnKey &&
    tagSuggestionOpen &&
    Boolean(tagSuggestionPosition);

  useEffect(() => {
    if (filterField !== tagsColumnKey || !tagSuggestionOpen) {
      setTagSuggestionPosition(null);
      return undefined;
    }

    const updatePosition = () => {
      const input = searchInputRef.current;

      if (!input) {
        return;
      }

      const bounds = input.getBoundingClientRect();
      setTagSuggestionPosition({
        top: bounds.bottom + 6,
        left: bounds.left,
        width: Math.max(bounds.width, 220),
      });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [filterField, tagSuggestionOpen]);

  useEffect(() => {
    if (!tagListVisible) {
      return undefined;
    }

    const closeOnOutsidePress = (event) => {
      if (
        searchInputRef.current?.contains(event.target) ||
        tagSuggestionListRef.current?.contains(event.target)
      ) {
        return;
      }

      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
    };

    document.addEventListener("mousedown", closeOnOutsidePress);
    return () => document.removeEventListener("mousedown", closeOnOutsidePress);
  }, [tagListVisible]);

  useEffect(() => {
    if (filterField !== tagsColumnKey) {
      setTagSuggestionOpen(false);
      setTagSuggestionIndex(-1);
    }
  }, [filterField]);

  const currentRoute = useMemo(
    () => parseTableHash(location.hash),
    [location.hash],
  );
  // Latest route for effects that must not re-run on route changes (e.g.
  // the filter reset below, which answers only to collection changes).
  currentRouteRef.current = currentRoute;
  const orderedNotes = useMemo(
    () => applyTableView(notes, conditions, sortKey, sortDirection, searchColumns),
    [conditions, notes, searchColumns, sortDirection, sortKey],
  );
  // The painted row list lags one step behind the filter state: inputs,
  // chips, and counts stay instant while the heavy row re-mount happens in
  // a background render. Everything that reads note *identity* (selection,
  // nav, slideshow) keeps using the urgent list.
  const deferredOrderedNotes = useDeferredValue(orderedNotes);
  const rowsPending = deferredOrderedNotes !== orderedNotes;
  const slideshowRouteActive = currentRoute.kind === "slideshow";
  const creatingNote = isCreateRoute(currentRoute);
  const editingNoteId = isEditNoteRoute(currentRoute)
    ? currentRoute.noteId
    : null;
  // The editor is a modal overlay: while it is open, the table and the
  // slideshow behind it must not be reachable, so a stray Tab cannot click
  // "Edit note", the toolbar, or a row and discard unsaved work silently.
  const editorOverlayOpen = Boolean(editingNoteId || creatingNote);
  const createAfterId =
    creatingNote &&
    currentRoute.afterId &&
    notes.some((note) => note.id === currentRoute.afterId)
      ? currentRoute.afterId
      : null;
  const createBeforeId =
    creatingNote &&
    currentRoute.beforeId &&
    notes.some((note) => note.id === currentRoute.beforeId)
      ? currentRoute.beforeId
      : null;
  const createOverlayReferenceId =
    creatingNote &&
    currentRoute.overlayCreate &&
    slideshowNotes.some((note) => note.id === currentRoute.noteId)
      ? currentRoute.noteId
      : null;
  const createPositionReferenceId =
    createAfterId ?? createBeforeId ?? createOverlayReferenceId;
  const createPositionMode = createAfterId
    ? "after"
    : createPositionReferenceId
      ? "before"
      : "end";
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
  // Where the incoming Note will sit: before or after the reference Note, or
  // at the end of the list. The arrows and typed jumps move relative to that
  // slot, wrapping around the ends exactly as edit mode does.
  const createSlotIndex = creatingNote
    ? (() => {
        if (createPositionReferenceId == null) {
          return editorList.length;
        }

        const referenceIndex = editorList.findIndex(
          (note) => note.id === createPositionReferenceId,
        );

        if (referenceIndex < 0) {
          return editorList.length;
        }

        return createPositionMode === "after"
          ? referenceIndex + 1
          : referenceIndex;
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

    const contextConditions = conditionsFromRoute(currentRoute);
    const contextSortKey =
      currentRoute.slideshowSortKey &&
      validSortKeys.has(currentRoute.slideshowSortKey)
        ? currentRoute.slideshowSortKey
        : defaultSortKey;
    const contextSortDirection =
      currentRoute.slideshowSortDirection === "desc" ? "desc" : "asc";

    return applyTableView(
      notes,
      contextConditions,
      contextSortKey,
      contextSortDirection,
      dataColumns,
    );
  }, [currentRoute, notes]);

  function navigateToTableRoute(nextRoute, { replace = false } = {}) {
    const nextHash = buildTableHash(nextRoute);
    const nextUrl = `${location.pathname}${nextHash}`;
    navigate(nextUrl, { replace });
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
        slideshowConditions: currentRoute.slideshowConditions,
        slideshowSortDirection: currentRoute.slideshowSortDirection,
        slideshowSortKey: currentRoute.slideshowSortKey,
      };
    }

    return {
      slideshowCollectionId: Number.isInteger(collectionId)
        ? collectionId
        : null,
      slideshowConditions: conditions,
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

  async function loadNotes() {
    if (!Number.isInteger(collectionId)) {
      setNotes([]);
      return [];
    }

    const payload = await getNotes(collectionId);
    setNotes(payload.notes);
    return payload.notes;
  }

  useEffect(() => {
    if (loadingCollections) {
      return;
    }

    if (!Number.isInteger(collectionId)) {
      setLoading(false);
      setNotes([]);
      return;
    }

    let active = true;
    setLoading(true);
    setLoadError("");

    getNotes(collectionId)
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
  }, [collectionId, loadingCollections]);

  useEffect(() => {
    setSelectedIds((current) => {
      const next = current.filter((id) =>
        notes.some((note) => note.id === id),
      );

      // Keep the same array when nothing was pruned: a refetch must not look
      // like a user selection change (and must not re-render the table).
      return next.length === current.length ? current : next;
    });
  }, [notes]);

  // Filters reset only when the viewed collection actually changes. Route
  // changes (opening/closing the slideshow) leave them alone, and while a
  // slideshow URL with filter+sort context is open the URL owns them.
  useEffect(() => {
    resetColumnScroll();

    const route = currentRouteRef.current;

    if (route?.kind === "slideshow" && hasSlideshowContext(route)) {
      return;
    }

    setConditions([]);
    setFilterDraft("");
    setEditingConditionId(null);
    setFilterField(defaultFilterField);
  }, [collectionId]);

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
      const createReferenceId =
        currentRoute.afterId ?? currentRoute.beforeId;

      if (
        createReferenceId &&
        !notes.some((note) => note.id === createReferenceId)
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
    // so a new tab, refresh, or bookmark keeps the same 1/N position. Without
    // context the slideshow walks the table's own order: filters start empty
    // and the sort is the collection's saved one.
    const baseNotes = hasSlideshowUrlContext
      ? (slideshowContextNotes ?? [])
      : orderedNotes;

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
          slideshowConditions: currentRoute.slideshowConditions,
          slideshowSortDirection: currentRoute.slideshowSortDirection,
          slideshowSortKey: currentRoute.slideshowSortKey,
        },
        { replace: true },
      );
    }
  }, [
    collectionId,
    currentRoute,
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

  const hasActiveFilters = conditions.length > 0;
  // Chips grouped by field: same-field values OR, different fields AND.
  const conditionGroups = useMemo(() => {
    const groups = new Map();

    for (const condition of conditions) {
      if (!groups.has(condition.field)) {
        groups.set(condition.field, []);
      }
      groups.get(condition.field).push(condition);
    }

    return Array.from(groups, ([field, items]) => ({ field, items }));
  }, [conditions]);

  const filterPlaceholder =
    filterField === "all"
      ? "Search every visible field…"
      : `Filter ${filterFieldLabel(filterField).toLowerCase()}…`;
  // Permanent columns are always rendered; a hideable column is rendered only
  // while the collector's per-collection choice includes it.
  const visibleColumns = useMemo(
    () =>
      tableColumns.filter(
        (column) =>
          !column.hideable || visibleColumnKeys.includes(column.key),
      ),
    [visibleColumnKeys],
  );
  // Control columns keep their declared width; the data columns share the
  // viewport leftover in proportion to theirs. Every <col> therefore gets an
  // explicit width that adds up to the table width, so a wide window cannot
  // fall back to stretching the fixed identity columns.
  const columnWidths = useMemo(
    () =>
      tableColumnWidths(
        visibleColumns,
        Math.max(tableWidth ?? minTableWidth, minTableWidth),
        vScroll.visible ? tableGutterWidth : 0,
      ),
    [visibleColumns, tableWidth, vScroll.visible],
  );
  // Pinned identity columns take a cumulative left offset over the visible
  // sticky columns only, so a hidden column never leaves a gap in the block.
  // The rendered widths are used because a pinned data column flexes.
  const stickyLeftByColumn = useMemo(
    () => stickyOffsets(visibleColumns, columnWidths),
    [visibleColumns, columnWidths],
  );
  const lastStickyColumnKey = useMemo(
    () => lastStickyKey(visibleColumns),
    [visibleColumns],
  );
  // The one field column that must stay visible: once it is alone, its
  // checkbox is disabled so the collector cannot reduce the table to
  // identity columns only.
  const lastVisibleDataColumnKey = useMemo(() => {
    const visibleDataKeys = hideableDataColumns
      .filter((column) => visibleColumnKeys.includes(column.key))
      .map((column) => column.key);

    return visibleDataKeys.length === 1 ? visibleDataKeys[0] : null;
  }, [visibleColumnKeys]);
  const totalColumnCount =
    visibleColumns.length +
    // Trailing empty gutter column shared by the header and every body row,
    // so row paint continues under the overlay scrollbar while row content
    // still stops before it.
    (vScroll.visible ? 1 : 0);
  const isDefaultOrder =
    sortKey === defaultSortKey && sortDirection === "asc";
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
  // Reset view only undoes view state; the column choice is structure and
  // stays put, so it must not offer a reset that would change nothing.
  const canResetView = useMemo(
    () =>
      hasActiveFilters ||
      sortKey !== defaultSortKey ||
      sortDirection !== "asc" ||
      selectedIds.length > 0,
    [hasActiveFilters, selectedIds, sortDirection, sortKey],
  );
  const rowVirtualizer = useVirtualizer({
    count: deferredOrderedNotes.length,
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => tableScrollRef.current,
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
    const saved = savedTableViewRef.current;
    const switchedCollection = saved.collectionId !== collectionId;
    const unchanged = saved.tableView === tableView;

    savedTableViewRef.current = { collectionId, tableView };

    // The first load and a collection switch adopt what storage already says;
    // only a user change is written back. That keeps a slideshow link's sort
    // from rewriting the collection's saved one.
    if (switchedCollection || unchanged) {
      return;
    }

    saveTableState(collectionId, tableView);
  }, [collectionId, tableView]);

  useEffect(() => {
    rowVirtualizer.scrollToOffset(0);
  }, [conditions, rowVirtualizer, sortDirection, sortKey]);

  // Switching collections opens a fresh table view at its first fields and
  // first rows, not where the previous collection was left. The notes load
  // unmounts the scrollers, so a reset issued before the remount is lost —
  // reset again once the new table has mounted (loading false).
  useEffect(() => {
    if (loading) {
      return;
    }

    resetColumnScroll();

    if (tableScrollRef.current) {
      tableScrollRef.current.scrollTop = 0;
    }

    rowVirtualizer.scrollToOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, loading]);

  useEffect(() => {
    // A changed filter or sort produces a new row order: drop any keyboard
    // focus target from the previous order (including a not-yet-landed
    // virtualized focus) so the next ArrowDown starts at the first row of
    // the new order. The active-row cue belongs to the old order too, and so
    // do the last-focused-row memory and any focus still waiting on a list
    // change: they name rows of the old order. A collection switch is a new
    // order too.
    pendingRowFocusNoteIdRef.current = null;
    deferredRowFocusNoteIdRef.current = null;
    deferredAnchorFocusRef.current = false;
    pendingSlideshowLandingRef.current = null;
    lastRowFocusNoteIdRef.current = null;
    clearRowCursor();
  }, [clearRowCursor, collectionId, conditions, sortDirection, sortKey]);

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
  // keep the custom thumb in sync with the table scroller.
  const updateVScroll = useCallback(() => {
    const scroller = tableScrollRef.current;

    if (!scroller) {
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
    // Both native scrollbars are hidden, so the custom track runs to the
    // bottom edge instead of stopping above a bar.
    const top = headerHeight + 4;
    const bottom = 4;
    const trackHeight = Math.max(0, scroller.clientHeight - top - bottom);

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
    const scroller = tableScrollRef.current;

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
    window.addEventListener("resize", scheduleUpdate);

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(scroller);

    const header = scroller.querySelector("thead");

    if (header) {
      observer.observe(header);
    }

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [loading, deferredOrderedNotes.length, updateVScroll]);

  // The data columns need the space the table can occupy, not the table's own
  // rendered width: once the columns are wide, a fixed-layout table refuses to
  // shrink below their total. The scroller is independent of that content and
  // keeps shrinking with the window.
  useLayoutEffect(() => {
    const scroller = tableScrollRef.current;

    if (!scroller) {
      return undefined;
    }

    const measure = () => {
      const nextWidth = scroller.getBoundingClientRect().width;
      setTableWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [loading, loadError]);

  function handleVThumbPointerDown(event) {
    event.preventDefault();
    event.stopPropagation();

    const scroller = tableScrollRef.current;

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
    const scroller = tableScrollRef.current;
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

    const scroller = tableScrollRef.current;
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
    const scroller = tableScrollRef.current;

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

  // Returns the table scroller when the columns actually overflow, so
  // panning is a no-op on a wide window just like the Viewer's table.
  function columnScroller() {
    const scroller = tableScrollRef.current;

    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) {
      return null;
    }

    return scroller;
  }

  function scrollColumnsTo(scroller, left) {
    // Chromium animates the pan; jsdom (tests) has no scrollTo, so fall back
    // to a direct assignment there.
    if (typeof scroller.scrollTo === "function") {
      // The shadow follows the scroll event, so it appears as the pan starts
      // and clears exactly when the table reaches its start.
      scroller.scrollTo({ behavior: "smooth", left });
      return;
    }

    scroller.scrollLeft = left;
    syncColumnScroll(scroller);
  }

  // The pinned block's edge shadow is scroll state, not hover state: it only
  // applies once the columns have moved underneath. Kept in sync from the
  // scroller's scroll event and from every programmatic pan, because jsdom's
  // direct scrollLeft writes never dispatch a scroll event.
  //
  // The pinned cells themselves need no scroll offset: .table-scroll-x is the
  // scrollport for both axes, so native sticky keeps them fixed while the
  // columns pan (see .table-sticky-cell in styles.css).
  function syncColumnScroll(scroller = tableScrollRef.current) {
    setColumnsScrolled(isColumnPanShadowVisible(scroller?.scrollLeft ?? 0));
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
    const scroller = tableScrollRef.current;

    if (scroller) {
      scroller.scrollLeft = 0;
      syncColumnScroll(scroller);
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
    const scroller = tableScrollRef.current;

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
    syncColumnScroll(scroller);
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

    const scroller = tableScrollRef.current;

    if (!scroller) {
      return undefined;
    }

    // The preview hangs beside the thumbnail, inside its cell. It is 138px
    // tall against a 46px row, so it is nudged up or down to stay inside the
    // rows area instead of running under the header or past the last row.
    function updateThumbPreviewPosition() {
      const thumbElement = thumbPreviewElementMapRef.current.get(
        thumbPreviewState.noteId,
      );

      if (!thumbElement) {
        setThumbPreviewState(null);
        return;
      }

      const scrollerBounds = scroller.getBoundingClientRect();
      const thumbBounds = thumbElement.getBoundingClientRect();
      const headerBottom =
        scroller.querySelector("thead")?.getBoundingClientRect().bottom ??
        scrollerBounds.top;
      const previewHeight = 138;
      const desiredTop =
        thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
      const minTop = Math.max(scrollerBounds.top + 8, headerBottom + 8);
      const maxTop = scrollerBounds.bottom - previewHeight - 8;
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
    scroller.addEventListener("scroll", updateThumbPreviewPosition, {
      passive: true,
    });
    window.addEventListener("resize", updateThumbPreviewPosition);

    return () => {
      scroller.removeEventListener("scroll", updateThumbPreviewPosition);
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

      if (event.target.closest(".table-bulk-bar")) {
        // The selection bar is part of the row's tab cycle: focusing it
        // must keep the row cursor (and the remembered exit target) alive.
        return;
      }

      if (event.target.closest("#app-sidebar")) {
        // The sidebar is opened with "b" from the row cursor. Keep that
        // cursor lit while the rail is on screen; focus moving anywhere else
        // still clears it below.
        return;
      }

      // Any focus move that is not one of the arming actions (a selection
      // change or a keyboard row move) cancels a pending Tab-to-bar jump.
      selectionTabArmedRef.current = false;
      pendingRowKeyboardFocusArmRef.current = null;

      if (event.target !== tableFocusAnchorRef.current) {
        // Any other focus target ends the "resume after Escape" intent.
        escapeResumeNoteIdRef.current = null;
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
    // The row-navigation keys share one meaning whether the row itself or a
    // checkbox inside it holds focus: arrows/j/k move the cursor, Page and
    // Home/End jump, and a held Shift rests where it is. Returns whether the
    // key was one of them.
    function armSelectionTabForRowMove(noteId) {
      // With a selection on screen, moving the row cursor makes the bar the
      // next Tab stop again. A virtualized target only receives focus once
      // it mounts, so its arming waits for the row ref callback.
      if (noteId == null || !selectedIdsRef.current.length) {
        return;
      }

      const element = rowElementMapRef.current.get(noteId);

      if (element && document.activeElement === element) {
        selectionTabArmedRef.current = true;
      } else {
        pendingRowKeyboardFocusArmRef.current = noteId;
      }
    }

    function isPageBackgroundTarget(target) {
      // A click on non-focusable chrome leaves the document's active
      // element on <body> / <html>.
      return target === document.body || target === document.documentElement;
    }

    function isScreenChromeTarget(target) {
      // Escape above the table must still reach the table's state. The page
      // background counts, and so does the screen's own chrome (title row,
      // toolbar, footer) outside the table card. Controls inside the card
      // keep their own keys, and modal surfaces own every key.
      if (isPageBackgroundTarget(target)) {
        return true;
      }

      return (
        target instanceof Element &&
        Boolean(tableScreenRef.current?.contains(target)) &&
        !tableShellRef.current?.contains(target) &&
        !target.closest(MODAL_SURFACE_SELECTOR)
      );
    }

    function handleRowNavigation(event) {
      // After Escape dropped a mouse-only selection to the anchor, the
      // first arrow press paints the row the pointer last touched rather
      // than walking from the top of the table.
      const resumeId = escapeResumeNoteIdRef.current;

      if (
        resumeId != null &&
        document.activeElement === tableFocusAnchorRef.current &&
        !event.shiftKey &&
        (event.key === "ArrowDown" ||
          event.key === "ArrowUp" ||
          event.key === "j" ||
          event.key === "k")
      ) {
        escapeResumeNoteIdRef.current = null;
        event.preventDefault();
        focusRowByNoteId(resumeId);
        return true;
      }

      if (!event.shiftKey && (event.key === "ArrowDown" || event.key === "j")) {
        event.preventDefault();
        armSelectionTabForRowMove(moveRowFocus(1));
        return true;
      }

      if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "k")) {
        event.preventDefault();
        armSelectionTabForRowMove(moveRowFocus(-1));
        return true;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        armSelectionTabForRowMove(
          pageTable(event.key === "PageDown" ? 1 : -1),
        );
        return true;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const note =
          event.key === "Home"
            ? orderedNotes[0]
            : orderedNotes[orderedNotes.length - 1];

        if (note) {
          focusRowByNoteId(note.id);
          armSelectionTabForRowMove(note.id);
        }
        return true;
      }

      return false;
    }

    function handleRowEscape(event) {
      // Escape anywhere in a row — the row itself or a control inside it,
      // such as the checkbox, the denomination link or the actions button —
      // drops the row cursor and returns focus to the table anchor. Menus
      // and popovers that own Escape stop the event before it reaches here,
      // so they still close first. The anchor is focused explicitly (rather
      // than just blurring) so a following Tab press lands on the header's
      // "select all" checkbox, and a further Escape can still clear filters.
      if (
        event.key !== "Escape" ||
        !(event.target instanceof HTMLElement) ||
        !event.target.closest("tr.table-row-link")
      ) {
        return false;
      }

      event.preventDefault();
      focusTableAnchor();
      clearRowCursor();
      return true;
    }

    function handleSelectionEscape(event) {
      // Selection is a level above the row cursor. Escape with a selection
      // on screen drops the selection and leaves focus (and the cursor)
      // alone, so a second Escape is what sends the cursor to the anchor.
      // Only surfaces that belong to the table's selection respond: rows,
      // the selection bar, the header's select-all checkbox, the anchor,
      // and the screen chrome above the table. Text fields keep their own
      // Escape.
      if (
        event.key !== "Escape" ||
        !selectedIdsRef.current.length ||
        !(event.target instanceof Element)
      ) {
        return false;
      }

      const pageBackgroundFocused = isPageBackgroundTarget(event.target);

      // A text field inside a row still owns its own Escape.
      const isCheckbox =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox";

      if (!isCheckbox && isEditableElement(event.target)) {
        return false;
      }

      const inBulkBar = Boolean(event.target.closest(".table-bulk-bar"));
      const inRow = Boolean(event.target.closest("tr.table-row-link"));
      const isSelectAll = event.target === selectAllRef.current;
      const onAnchor = event.target === tableFocusAnchorRef.current;
      const onScreenChrome = isScreenChromeTarget(event.target);

      if (!inBulkBar && !inRow && !isSelectAll && !onAnchor && !onScreenChrome) {
        return false;
      }

      // A mouse-made selection has no painted row cursor, but the last
      // clicked checkbox still holds focus. Remember that row so the next
      // arrow press can paint it once the user is back on the keyboard.
      const mouseOnlyResumeId =
        activeNoteId == null
          ? selectedIdsRef.current[selectedIdsRef.current.length - 1] ?? null
          : null;

      event.preventDefault();
      clearSelection();

      if (inBulkBar) {
        // The bar unmounts with the selection, so hand focus back before it
        // goes. With a live row cursor (the painted highlight, not just the
        // focus memory a mouse click leaves) the cursor survives and the
        // next Escape drops it; without one (select-all, then Tab) the
        // anchor is the only sensible place left.
        const cursorId =
          activeNoteId != null &&
          orderedNotes.some((note) => note.id === activeNoteId)
            ? activeNoteId
            : null;

        if (cursorId != null) {
          focusRowByNoteId(cursorId);
        } else {
          if (mouseOnlyResumeId != null) {
            escapeResumeNoteIdRef.current = mouseOnlyResumeId;
          }
          focusTableAnchor();
        }

        return true;
      }

      if (mouseOnlyResumeId != null && !isSelectAll) {
        escapeResumeNoteIdRef.current = mouseOnlyResumeId;
      }

      if (pageBackgroundFocused) {
        // A click above the table dropped focus to <body>. Land on the
        // anchor so the next Escape can clear filters and the remembered
        // mouse row is still there for the arrow keys.
        focusTableAnchor();
      } else if (inRow && mouseOnlyResumeId != null) {
        // No painted cursor to keep, so drop the focus ring too: a
        // keyboard Escape would otherwise make the mouse-focused
        // checkbox focus-visible and repaint the row.
        focusTableAnchor();
      }

      return true;
    }

    function handleGlobalKeyDown(event) {
      if (showShortcutsHelp || confirmOpenRef.current) {
        return;
      }

      // Only an arrow press may consume the post-Escape resume intent;
      // anything else means the user moved on.
      if (
        event.key !== "ArrowDown" &&
        event.key !== "ArrowUp" &&
        event.key !== "j" &&
        event.key !== "k"
      ) {
        escapeResumeNoteIdRef.current = null;
      }

      // A checkbox is a form control but has no caret or text of its own, so
      // it must not swallow the table's single-key shortcuts. Scope this to
      // checkboxes inside the table: checkboxes in dialogs and other screens
      // keep their existing behaviour.
      const tableCheckboxFocused =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox" &&
        Boolean(event.target.closest("table"));
      const editable = !tableCheckboxFocused && isEditableElement(event.target);
      const tableKeysActive = !slideshowRouteActive && !editorOverlayOpen;

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
        searchInputRef.current?.focus();
        return;
      }

      if (handleSelectionEscape(event)) {
        return;
      }

      if (handleRowEscape(event)) {
        return;
      }

      if (
        event.key === "Tab" &&
        !event.shiftKey &&
        tableKeysActive &&
        event.target instanceof Node &&
        tableShellRef.current?.contains(event.target) &&
        selectionTabArmedRef.current &&
        selectedIdsRef.current.length > 0
      ) {
        // A fresh selection (or a row-cursor move while one exists) puts
        // the selection bar at the front of the table's tab cycle: the
        // next Tab enters its first enabled control instead of walking
        // the row's checkbox and links.
        const firstBarItem = bulkBarRef.current?.querySelector(
          "button:not([disabled])",
        );

        if (firstBarItem) {
          event.preventDefault();
          selectionTabArmedRef.current = false;
          firstBarItem.focus();
          return;
        }
      }

      if (
        event.key === "Escape" &&
        (editable || tableCheckboxFocused) &&
        event.target instanceof Element &&
        event.target.closest("thead")
      ) {
        event.preventDefault();
        // Leave the filter (or the select-all checkbox) and land straight on
        // the first row (Esc behaves like ArrowDown here). With no rows to
        // land on, fall back to the focus anchor so a further Escape can
        // still clear the filters.
        if (orderedNotes[0]) {
          focusRowByNoteId(orderedNotes[0].id);
        } else {
          focusTableAnchor();
          clearRowCursor();
        }
        return;
      }

      if (editable) {
        // Text fields keep their own keys: caret movement, dropdowns and
        // native editing must win over the table's single-key shortcuts.
        return;
      }

      if (handleRowNavigation(event)) {
        return;
      }

      if (pointsToStart || pointsToEnd) {
        const delta = pointsToStart ? -COLUMN_SCROLL_STEP : COLUMN_SCROLL_STEP;

        if (panColumnsBy(delta)) {
          event.preventDefault();
        }
        return;
      }

      const onAnchor = event.target === tableFocusAnchorRef.current;
      const pageBackgroundFocused = isPageBackgroundTarget(event.target);

      if (
        event.key === "Escape" &&
        (onAnchor || isScreenChromeTarget(event.target))
      ) {
        // Deselected-row state (see above): one more Escape clears the
        // filters, if any are set. Focus stays where the press came from,
        // except on the page background, where it lands on the anchor.
        if (hasActiveFilters) {
          event.preventDefault();
          setConditions([]);

          if (pageBackgroundFocused) {
            focusTableAnchor();
          }
        }

        if (onAnchor || hasActiveFilters) {
          return;
        }
      }

      const focusedRowElement = focusedRowIdRef.current
        ? rowElementMapRef.current.get(focusedRowIdRef.current)
        : null;
      const activeElement = document.activeElement;
      // A row checkbox is a nested control with no text of its own. Treat it
      // like the row for the single-key shortcuts, while Space keeps toggling
      // the selection and the arrow keys keep walking the table.
      const rowCheckboxFocused =
        tableCheckboxFocused &&
        Boolean(focusedRowElement) &&
        focusedRowElement.contains(activeElement);
      // Focusing any control inside a row bubbles focus to the row, so the
      // row cursor can still be "on" a row while a nested button holds focus.
      // `contains` keeps `a` inserting after that row instead of treating it
      // as no row at all.
      const focusWithinFocusedRow =
        Boolean(focusedRowElement) &&
        focusedRowElement.contains(activeElement);
      const rowHasFocus =
        Boolean(focusedRowElement) &&
        (activeElement === focusedRowElement || rowCheckboxFocused);

      // "a" opens the create form after the focused row when the cursor is
      // on (or inside) one, otherwise it falls back to the toolbar's Add
      // action so the shortcut still works from an empty focus state or right
      // after the row cursor was cleared. This matches the row menu's
      // "Insert note below" item, which advertises the same shortcut.
      if (event.key === "a") {
        // An empty library has no collection to create a note in. The toolbar
        // button is disabled; the shortcut has to match it. A not-yet-saved
        // collection has no id to create a note in either.
        if (noCollections || isNewCollection) {
          return;
        }

        event.preventDefault();

        if (focusWithinFocusedRow) {
          openCreateNoteAfter(focusedRowIdRef.current);
        } else {
          openCreateNote();
        }

        return;
      }

      // "o" opens the focused row's actions menu through the menu's own
      // imperative handle, so it shares the button's open path. Focus may sit
      // on the row or on a control inside it — after Escape returns focus to
      // the actions button, pressing `o` must still reopen the menu.
      if (event.key === "o" && focusWithinFocusedRow) {
        const actionsMenu = rowActionsMenuMapRef.current.get(
          focusedRowIdRef.current,
        );

        if (!actionsMenu) {
          return;
        }

        event.preventDefault();
        actionsMenu.open();
        return;
      }

      if (!rowHasFocus) {
        // No row cursor: Esc leaves the collection edit mode (the title
        // field itself handles this with its own key handler), and `e`
        // opens it instead of a note. A not-yet-saved collection already
        // shows its name field.
        if (
          event.key === "Escape" &&
          !focusWithinFocusedRow &&
          isCollectionEditing &&
          onCancelCollectionEdit
        ) {
          event.preventDefault();
          onCancelCollectionEdit();
          return;
        }
        if (
          event.key === "e" &&
          !focusWithinFocusedRow &&
          collection &&
          Number.isInteger(collectionId) &&
          !isNewCollection &&
          !isCollectionEditing
        ) {
          event.preventDefault();
          navigate(CATALOG_ROUTES.collectionEdit(collectionId));
        }
        return;
      }

      const focusedNote = orderedNotes.find(
        (note) => note.id === focusedRowIdRef.current,
      );

      if (!focusedNote) {
        return;
      }

      // Enter on a row checkbox opens the note, matching Enter on the row
      // itself. The checkbox's own Space keeps toggling the selection.
      if (rowCheckboxFocused && event.key === "Enter") {
        event.preventDefault();
        openSlideshow(focusedNote.id);
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
    activeNoteId,
    clearRowCursor,
    clearSelection,
    collection,
    collectionId,
    creatingNote,
    editingNoteId,
    hasActiveFilters,
    isCollectionEditing,
    isNewCollection,
    navigate,
    noCollections,
    onCancelCollectionEdit,
    orderedNotes,
    rowVirtualizer,
    slideshowRouteActive,
    showShortcutsHelp,
  ]);

  function resetTableState() {
    setConditions([]);
    setFilterDraft("");
    setEditingConditionId(null);
    setConditionDraft("");
    setFilterField(defaultFilterField);
    // Columns are structure, not view state: Reset view restores the default
    // order but leaves the collector's column choice alone.
    const defaults = defaultTableState();
    setTableView((current) => ({
      ...current,
      sortKey: defaults.sortKey,
      sortDirection: defaults.sortDirection,
    }));
    if (showSelection) {
      setSelectedIds([]);
    }
  }

  // Commit is explicit: Enter turns the field text into chips. Duplicates are
  // ignored, so re-typing a value does not silently add a second OR arm.
  function commitFilterDraft(raw = filterDraft) {
    const parsed = conditionsFromInput(filterField, raw);

    if (!parsed.length) {
      return;
    }

    setConditions((current) => {
      const seen = new Set(current.map(conditionIdentity));
      return [
        ...current,
        ...parsed.filter((condition) => !seen.has(conditionIdentity(condition))),
      ];
    });
    setFilterDraft("");
    closeTagSuggestions();
  }

  function openTagSuggestions(index = -1) {
    setTagSuggestionOpen(true);
    setTagSuggestionIndex(index);
  }

  function closeTagSuggestions() {
    setTagSuggestionOpen(false);
    setTagSuggestionIndex(-1);
  }

  function scrollTagSuggestionIntoView(element) {
    // jsdom has no scrollIntoView; the guard keeps highlight paint working
    // there while a browser scrolls the option into view.
    element?.scrollIntoView?.({ block: "nearest" });
  }

  // A suggestion fills the Tags chip directly. Unknown tags are not offered
  // here: creating one is the note editor's job.
  function pickTagSuggestion(tag) {
    commitFilterDraft(tag);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function removeCondition(id) {
    setConditions((current) =>
      current.filter((condition) => condition.id !== id),
    );
  }

  function removeFieldConditions(field) {
    setConditions((current) =>
      current.filter((condition) => condition.field !== field),
    );
  }

  function clearAllFilters() {
    setConditions([]);
  }

  function startConditionEdit(condition) {
    setEditingConditionId(condition.id);
    setConditionDraft(`${condition.negated ? "!" : ""}${condition.value}`);
  }

  function cancelConditionEdit() {
    setEditingConditionId(null);
    setConditionDraft("");
  }

  function commitConditionEdit() {
    if (editingConditionId == null) {
      return;
    }

    const id = editingConditionId;
    const raw = conditionDraft.trim();
    setEditingConditionId(null);
    setConditionDraft("");

    setConditions((current) => {
      const negated = raw.startsWith("!");
      const value = (negated ? raw.slice(1) : raw).trim();

      if (!value) {
        return current.filter((condition) => condition.id !== id);
      }

      return current.map((condition) =>
        condition.id === id ? { ...condition, value, negated } : condition,
      );
    });
  }

  function handleSearchKeyDown(event) {
    const tagsField = filterField === tagsColumnKey;

    // The tags list opens on demand: typing opens it, and so does a plain
    // Down. The other fields keep handing a plain Down to the first row.
    if (
      tagsField &&
      !event.shiftKey &&
      (event.key === "ArrowDown" || event.key === "ArrowUp")
    ) {
      event.preventDefault();

      if (!tagSuggestionOpen) {
        if (event.key === "ArrowDown") {
          openTagSuggestions(tagMatches.length ? 0 : -1);
        }
        return;
      }

      if (!tagMatches.length) {
        return;
      }

      setTagSuggestionIndex((current) => {
        const step = event.key === "ArrowDown" ? 1 : -1;

        if (current < 0) {
          return event.key === "ArrowDown" ? 0 : tagMatches.length - 1;
        }

        return (current + step + tagMatches.length) % tagMatches.length;
      });
      return;
    }

    const tagListOpen =
      tagsField && tagSuggestionOpen && tagMatches.length > 0;

    if (
      tagListOpen &&
      event.key === "Enter" &&
      tagSuggestionIndex >= 0 &&
      tagMatches[tagSuggestionIndex]
    ) {
      event.preventDefault();
      pickTagSuggestion(tagMatches[tagSuggestionIndex]);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitFilterDraft();
      return;
    }

    if (tagListOpen && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTagSuggestions();
      return;
    }

    if (event.key === "ArrowDown" && !event.shiftKey) {
      // Plain Down hands off to the first row; Shift+Down stays in the field.
      event.preventDefault();

      if (orderedNotes[0]) {
        focusRowByNoteId(orderedNotes[0].id);
      }
      return;
    }

    if (event.key === "Escape") {
      // Escape leaves the field without clearing the draft or reaching the
      // table's row/anchor Escape handling. Like ArrowDown, it lands on the
      // first row so the table has a visible cursor to continue from.
      event.preventDefault();
      event.stopPropagation();

      if (orderedNotes[0]) {
        focusRowByNoteId(orderedNotes[0].id);
      } else {
        event.currentTarget.blur();
      }
    }
  }

  function applyTagFilter(tagName, { replace = false } = {}) {
    setConditions((current) => {
      const others = replace
        ? current.filter((condition) => condition.field !== tagsColumnKey)
        : current;

      if (
        others.some(
          (condition) =>
            condition.field === tagsColumnKey &&
            !condition.negated &&
            condition.value.toLowerCase() === tagName.toLowerCase(),
        )
      ) {
        return others;
      }

      return [...others, makeCondition(tagsColumnKey, tagName)];
    });

    resetColumnScroll();
  }

  function showThumbPreview(noteId) {
    setThumbPreviewState({ noteId, offsetY: 0 });
  }

  function hideThumbPreview(noteId) {
    setThumbPreviewState((current) =>
      current?.noteId === noteId ? null : current,
    );
  }

  function toggleColumnVisibility(key) {
    if (!visibleColumnKeys.includes(key)) {
      const restoredColumns = hideableColumnKeys.filter(
        (currentKey) =>
          currentKey === key || visibleColumnKeys.includes(currentKey),
      );

      setTableView((current) => ({
        ...current,
        visibleColumnKeys: restoredColumns,
      }));
      return;
    }

    // Never leave the table with no field column at all: the permanent
    // identity columns alone cannot be read as data.
    const remaining = visibleColumnKeys.filter(
      (currentKey) => currentKey !== key,
    );

    if (!keepsADataColumn(remaining)) {
      return;
    }

    // A hidden column must not keep hiding rows: drop its chips with it.
    removeFieldConditions(key);

    if (filterField === key) {
      setFilterField(defaultFilterField);
    }

    let nextSortKey = sortKey;
    let nextSortDirection = sortDirection;

    if (sortKey === key) {
      // The sorted column is about to disappear. Fall back to the first
      // still-rendered sortable column (the display-order `id` when it is
      // visible) so the active sort is always one of the rendered headers.
      const remainingVisible = tableColumns.filter(
        (column) => !column.hideable || remaining.includes(column.key),
      );
      const nextSortColumn =
        remainingVisible.find((column) => column.sortable) ??
        getTableColumn(defaultSortKey);

      nextSortKey = nextSortColumn?.key ?? defaultSortKey;
      nextSortDirection = "asc";
    }

    setTableView((current) => ({
      ...current,
      sortKey: nextSortKey,
      sortDirection: nextSortDirection,
      visibleColumnKeys: remaining,
    }));
  }

  function toggleSort(key) {
    setTableView((current) => ({
      ...current,
      sortKey: key,
      sortDirection:
        current.sortKey === key && current.sortDirection === "asc"
          ? "desc"
          : "asc",
    }));
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

  // Focus a mounted row's control and make that row the cursor. A null
  // selector focuses the row element itself.
  function focusRowControlInElement(element, noteId, selector) {
    const control = selector ? element.querySelector(selector) : element;

    (control ?? element).focus({ preventScroll: true });
    focusedRowIdRef.current = noteId;
    setActiveNoteId(noteId);
    ensureRowVisible(element);
  }

  // The row a bar exit returns to: the live keyboard cursor when it still
  // exists, otherwise the row selected most recently (the end of the
  // selection array, which is also the checkbox the user touched last).
  function bulkBarExitNoteId() {
    if (
      activeNoteId != null &&
      orderedNotes.some((note) => note.id === activeNoteId)
    ) {
      return activeNoteId;
    }

    const ids = selectedIdsRef.current;
    return ids.length ? ids[ids.length - 1] : null;
  }

  function focusRowControlByNoteId(noteId, selector, pendingRef) {
    if (noteId == null) {
      focusTableAnchor();
      return;
    }

    const row = rowElementMapRef.current.get(noteId);
    const control = row?.querySelector(selector);

    if (row && control) {
      control.focus({ preventScroll: true });
      focusedRowIdRef.current = noteId;
      setActiveNoteId(noteId);
      ensureRowVisible(row);
      return;
    }

    const index = orderedNotes.findIndex((note) => note.id === noteId);

    if (index < 0) {
      focusTableAnchor();
      return;
    }

    // The target row is outside the virtualized window. Scroll it in and
    // let the row ref callback focus the control once it mounts.
    pendingRef.current = noteId;
    rowVirtualizer.scrollToIndex(index, { align: "auto" });
  }

  function focusRowCheckboxByNoteId(noteId) {
    focusRowControlByNoteId(
      noteId,
      'input[type="checkbox"]',
      pendingRowCheckboxFocusNoteIdRef,
    );
  }

  function focusRowActionsButtonByNoteId(noteId) {
    focusRowControlByNoteId(
      noteId,
      'button[aria-haspopup="menu"]',
      pendingRowActionsFocusNoteIdRef,
    );
  }

  function handleBulkBarKeyDown(event) {
    if (event.key !== "Tab") {
      return;
    }

    const items = Array.from(
      bulkBarRef.current?.querySelectorAll("button:not([disabled])") ?? [],
    );

    if (!items.length) {
      return;
    }

    const atFirst = document.activeElement === items[0];
    const atLast = document.activeElement === items[items.length - 1];

    // The bar sits between a row and its controls in the tab cycle:
    // forward from Clear lands on the row's checkbox, backward from Delete
    // lands on the row's actions menu button.
    if (event.shiftKey && atFirst) {
      event.preventDefault();
      event.stopPropagation();
      selectionTabArmedRef.current = false;
      focusRowActionsButtonByNoteId(bulkBarExitNoteId());
      return;
    }

    if (!event.shiftKey && atLast) {
      event.preventDefault();
      event.stopPropagation();
      selectionTabArmedRef.current = false;
      focusRowCheckboxByNoteId(bulkBarExitNoteId());
    }
  }

  function moveRowFocus(offset) {
    if (!orderedNotes.length) {
      return null;
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
      })
    ) {
      searchInputRef.current?.focus();
      clearRowCursor();
      return null;
    }

    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      orderedNotes.length - 1,
    );
    const targetId = orderedNotes[nextIndex].id;

    focusRowByNoteId(targetId);
    return targetId;
  }

  function ensureRowVisible(element) {
    const scroller = tableScrollRef.current;

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
    const scroller = tableScrollRef.current;

    if (!scroller) {
      return;
    }

    const headerBottom =
      scroller.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
    scroller.scrollTop += element.getBoundingClientRect().top - headerBottom;
  }

  function pageTable(direction) {
    const scroller = tableScrollRef.current;

    if (!scroller || !orderedNotes.length) {
      return null;
    }

    const headerHeight = scroller.querySelector("thead")?.offsetHeight ?? 0;
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
    const firstVisibleIndex = rowVirtualizer.getVirtualItems()[0]?.index ?? 0;
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

    return target?.id ?? null;
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
    if (isNewCollection) {
      return;
    }

    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: null });
  }

  function openCreateNoteBefore(referenceNoteId) {
    if (isNewCollection) {
      return;
    }

    setActionError("");
    navigateToTableRoute({ kind: "create", beforeId: referenceNoteId });
  }

  // The create route carries the exact placement the user picked: "after" for
  // Insert note below (and the `a` shortcut), "before" for Add before. The
  // Position selector in the Note editor shows that same relationship rather
  // than translating it into a different reference note.
  function openCreateNoteAfter(referenceNoteId) {
    if (isNewCollection) {
      return;
    }

    setActionError("");
    navigateToTableRoute({ kind: "create", afterId: referenceNoteId });
  }

  function openCreateNoteOverSlideshow(referenceNoteId) {
    if (isNewCollection) {
      return;
    }

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
      // Renumber like a delete: the backend closes the source gap the same
      // way, so the ID column must not keep stale values.
      setNotes((current) => dropNoteAndRenumber(current, updatedNote.id));
      setSelectedIds((current) =>
        current.filter((id) => id !== updatedNote.id),
      );
      setSlideshowNotes((current) =>
        dropNoteAndRenumber(current, updatedNote.id),
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
    userSelectionChangeRef.current = true;
    setSelectedIds((current) =>
      current.includes(noteId)
        ? current.filter((id) => id !== noteId)
        : [...current, noteId],
    );
  }

  function toggleAllVisible() {
    userSelectionChangeRef.current = true;

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
    const scroller = tableScrollRef.current;

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
        collectionId,
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

    try {
      // Name the rows being destroyed, in the order they appear on screen.
      // "Delete 3 selected notes?" asks the collector to trust a count; the
      // first identities prove the selection is the one they meant.
      const selectedNotes = orderedNotes.filter((note) =>
        selectedIdSet.has(note.id),
      );
      const listedNotes = selectedNotes.slice(0, 3);
      const remainingCount = selectedNotes.length - listedNotes.length;
      const confirmed = await requestConfirmation({
        title: `Delete ${selectedIds.length} selected note${selectedIds.length === 1 ? "" : "s"}?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete",
        children: listedNotes.length ? (
          <div className="confirm-note-list">
            <ul>
              {listedNotes.map((note) => (
                <li key={note.id}>
                  <span className="confirm-note-name">
                    {noteDisplayName(note)}
                  </span>
                  <span className="confirm-note-sub">
                    {noteIdentityDetails(note)}
                  </span>
                </li>
              ))}
            </ul>
            {remainingCount > 0 ? (
              <p className="confirm-note-more">
                and {remainingCount} more
              </p>
            ) : null}
          </div>
        ) : null,
      });

      if (!confirmed) {
        return;
      }

      // The button reports progress only once work has started: it used to be
      // set before the dialog opened, so the pill behind an unanswered
      // "Delete 4 selected notes?" already read "Working…".
      setBulkLoading(true);

      // Land the cursor where the selection started: the row that takes
      // the topmost deleted slot, or the new last row when the selection
      // ran to the end.
      const removal = deleteFocusAfterRemoval(orderedNotes, selectedIds);

      await Promise.all(selectedIds.map((id) => deleteNote(id, collectionId)));
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
    const note =
      notes.find((entry) => entry.id === noteId) ??
      slideshowNotes.find((entry) => entry.id === noteId) ??
      null;
    const thumbnail = note ? noteThumbPath(note) : null;
    const details = note ? noteIdentityDetails(note) : "";
    const confirmed = await requestConfirmation({
      title: `Delete ${note ? noteDisplayName(note) : `note ${noteId}`}?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
      // The title names the note; this shows it, so a collector confirms the
      // object rather than a word three other rows also answer to.
      children: note ? (
        <div className="confirm-note">
          {thumbnail ? (
            <img
              alt=""
              className="confirm-note-thumb"
              src={thumbnail}
            />
          ) : null}
          <span className="confirm-note-meta">
            {details || "No grade, serial or date recorded."}
          </span>
        </div>
      ) : null,
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
      await deleteNote(noteId, collectionId);

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

      setNotes((current) => dropNoteAndRenumber(current, noteId));
      setSelectedIds((current) => current.filter((id) => id !== noteId));
      setSlideshowNotes((current) => dropNoteAndRenumber(current, noteId));

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

  // Row cells are rendered from the column model, so column order and the
  // set of columns live in one place. Each kind keeps its existing markup.
  function renderReorderCell(column, note) {
    return (
      <td
        {...stickyCellAttributes(column, cellClass(column))}
        onClick={(event) => event.stopPropagation()}
      >
        {canReorder ? (
          <button
            aria-label={`Move ${note.denomination}`}
            className="drag-handle"
            draggable={canReorder}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onDragEnd={clearDragState}
            onDragStart={(event) => {
              const row = rowElementMapRef.current.get(note.id);

              clearDragPreview();
              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(note.id));

              if (row) {
                const preview = row.cloneNode(true);
                preview.classList.add("table-drag-preview");
                preview.style.width = `${row.getBoundingClientRect().width}px`;
                document.body.appendChild(preview);
                dragPreviewRef.current = preview;
                event.dataTransfer.setDragImage(preview, 24, 24);
              }

              setDraggedNoteId(note.id);
              setDropTarget({
                noteId: note.id,
                placement: "before",
              });
            }}
            type="button"
          >
            <span className="drag-handle-dots" aria-hidden="true">
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
    );
  }

  function renderSelectionCell(column, note) {
    return (
      <td
        className={alignmentClass(column)}
        onClick={(event) => event.stopPropagation()}
        {...stickyCellAttributes(column, cellClass(column))}
      >
        <input
          aria-label={`Select ${note.denomination}`}
          checked={selectedIdSet.has(note.id)}
          onChange={() => toggleNote(note.id)}
          type="checkbox"
        />
      </td>
    );
  }

  function renderOrderCell(column, note) {
    return (
      <td {...stickyCellAttributes(column, cellClass(column))}>
        {note.display_order ?? "-"}
      </td>
    );
  }

  function renderThumbnailCell(column, note, frontThumb) {
    return (
      <td
        {...stickyCellAttributes(column, cellClass(column))}
      >
        {frontThumb ? (
          <span
            className="table-thumb-wrap"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                hideThumbPreview(note.id);
              }
            }}
            onFocus={() => showThumbPreview(note.id)}
            onMouseEnter={() => showThumbPreview(note.id)}
            onMouseLeave={() => hideThumbPreview(note.id)}
            ref={(element) => {
              if (element) {
                thumbPreviewElementMapRef.current.set(note.id, element);
              } else {
                thumbPreviewElementMapRef.current.delete(note.id);
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
            <span
              className={`table-thumb-preview${
                thumbPreviewState?.noteId === note.id ? " is-visible" : ""
              }`}
              style={{
                "--table-thumb-preview-offset": `${
                  thumbPreviewState?.noteId === note.id
                    ? thumbPreviewState.offsetY
                    : 0
                }px`,
              }}
            >
              {thumbPreviewState?.noteId === note.id ? (
                <img alt="" src={frontThumb} />
              ) : null}
            </span>
          </span>
        ) : (
          <span className="muted">-</span>
        )}
      </td>
    );
  }

  function renderDataCell(column, note, marks) {
    const rowMarks = marks ?? {};
    if (column.isTags) {
      return (
        <td className={cellClass(column)}>
          <TagsCell onApplyFilter={applyTagFilter} tags={note.tags} />
        </td>
      );
    }

    if (column.key === "grade") {
      // Grade is the first attribute a collector compares across a row, and
      // the one the catalogue is bought and sold on. It reads as a value, not
      // as more body text: tabular figures so columns of grades line up, and
      // a tint that separates the uncirculated band from the rest.
      const gradeValue = String(note.grade ?? "").trim();

      if (!gradeValue) {
        return (
          <td {...stickyCellAttributes(column, cellClass(column))}>
            <span className="muted">-</span>
          </td>
        );
      }

      const numericGrade = parseGradeValue(gradeValue);
      const tier =
        numericGrade == null
          ? "none"
          : numericGrade >= 65
            ? "unc"
            : numericGrade >= 50
              ? "choice"
              : "circulated";

      return (
        <td {...stickyCellAttributes(column, cellClass(column))}>
          <span className={`table-grade table-grade--${tier}`}>
            {highlightTerms(gradeValue, rowMarks.grade)}
          </span>
        </td>
      );
    }

    if (column.key === "denomination") {
      // The denomination is the note's source link: collectors expect it to
      // open the page the note came from, not the slideshow. The row itself
      // and the row menu's Open item still reach the Note slideshow. A note
      // without a source URL renders as plain text.
      return (
        <td className={cellClass(column)}>
          {note.url ? (
            <a
              draggable={false}
              href={note.url}
              onClick={(event) => event.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              {highlightTerms(note.denomination, rowMarks.denomination)}
            </a>
          ) : (
            highlightTerms(note.denomination, rowMarks.denomination)
          )}
        </td>
      );
    }

    return (
      <td {...stickyCellAttributes(column, cellClass(column))}>
        {highlightTerms(note[column.key], rowMarks[column.key])}
      </td>
    );
  }

  function renderActionsCell(column, note) {
    const noteLabel =
      note.denomination || note.catalog_number || `note ${note.id}`;
    const items = [
      {
        key: "open",
        icon: "open",
        label: "Open",
        onSelect: () => openSlideshow(note.id),
      },
      {
        key: "edit",
        icon: "edit",
        label: "Edit",
        onSelect: () => openEditor(note.id),
        shortcut: "e",
      },
      {
        key: "copy",
        icon: "copy",
        label: "Copy details",
        onSelect: () => void handleCopyNoteDetails(note),
        shortcut: "c",
      },
      {
        key: "insert",
        icon: "insert",
        label: "Insert note below",
        onSelect: () => openCreateNoteAfter(note.id),
        shortcut: "a",
      },
    ];

    if (note.url) {
      items.push({
        key: "source",
        icon: "source",
        label: "Open source",
        href: note.url,
      });
    }

    items.push({
      key: "delete",
      icon: "delete",
      label: "Delete",
      onSelect: () => void handleDeleteNote(note.id),
      danger: true,
      separated: true,
      shortcut: "d",
    });

    return (
      <td className={cellClass(column)}>
        <RowActionsMenu
          items={items}
          label={`Actions for ${noteLabel}`}
          ref={(instance) => {
            if (instance) {
              rowActionsMenuMapRef.current.set(note.id, instance);
            } else {
              rowActionsMenuMapRef.current.delete(note.id);
            }
          }}
          shortcut="o"
        />
      </td>
    );
  }

  // Props shared by every pinned cell: the left offset accumulated from the
  // visible sticky columns, the end marker on the right-most one, and any
  // class the cell already needed.
  function stickyCellAttributes(column, baseClassName) {
    if (!column.sticky) {
      return baseClassName ? { className: baseClassName } : {};
    }

    return {
      className: [
        baseClassName,
        "table-sticky-cell",
        column.key === lastStickyColumnKey ? "table-sticky-end" : null,
      ]
        .filter(Boolean)
        .join(" "),
      // Native sticky positions the cell at this offset in the shared
      // horizontal scrollport.
      style: {
        "--table-sticky-left": `${stickyLeftByColumn[column.key] ?? 0}px`,
      },
    };
  }

  function renderTableCell(column, note, frontThumb, marks) {
    let cell = null;

    switch (column.kind) {
      case "reorder":
        cell = renderReorderCell(column, note);
        break;
      case "selection":
        cell = renderSelectionCell(column, note);
        break;
      case "order":
        cell = renderOrderCell(column, note);
        break;
      case "thumbnail":
        cell = renderThumbnailCell(column, note, frontThumb);
        break;
      case "data":
        cell = renderDataCell(column, note, marks);
        break;
      case "actions":
        cell = renderActionsCell(column, note);
        break;
      default:
        break;
    }

    return cell ? <Fragment key={column.key}>{cell}</Fragment> : null;
  }

  return (
    <section className="screen-stack" ref={tableScreenRef}>
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
              selectedCollectionId={collectionId}
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

      <div className="screen-body" inert={editorOverlayOpen}>
        <div className="panel-heading panel-heading--compact">
          <div className="panel-heading-copy">
            <p className="eyebrow collection-eyebrow">Catalog</p>
            {isCollectionEditing ? (
              <form
                className="collection-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSaveCollectionEdit?.();
                }}
              >
                <input
                  aria-label="Collection name"
                  className="showcase-name-field"
                  disabled={savingCollectionEdit}
                  onBlur={onCollectionEditNameBlur}
                  onChange={(event) => onCollectionEditNameChange?.(event.target.value)}
                  onKeyDown={onCollectionEditNameKeyDown}
                  ref={collectionEditFieldRef}
                  value={collectionEditName}
                />
                <button
                  aria-label="Save"
                  className="showcase-node-save"
                  disabled={!canSaveCollectionEdit || savingCollectionEdit}
                  title="Save name"
                  type="submit"
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    height="13"
                    viewBox="0 0 24 24"
                    width="13"
                  >
                    <path
                      d="M4 12.5l5 5L20 6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                    />
                  </svg>
                </button>
                <button
                  aria-label="Cancel"
                  className="showcase-node-cancel"
                  onClick={onCancelCollectionEdit}
                  title="Discard changes"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    height="13"
                    viewBox="0 0 24 24"
                    width="13"
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
              </form>
            ) : showingNewCollectionForm ? (
              <form
                className="collection-rename-form"
                onSubmit={handleCollectionRenameSubmit}
              >
                <input
                  aria-label="Collection name"
                  className="showcase-name-field"
                  disabled={savingNewCollection}
                  onChange={(event) => {
                    onNewCollectionNameChange?.(event.target.value);
                  }}
                  onKeyDown={handleNewCollectionNameKeyDown}
                  ref={collectionNameFieldRef}
                  value={newCollectionName}
                />
                <button
                  aria-label="Save"
                  className="showcase-node-save"
                  disabled={savingNewCollection}
                  title="Save name"
                  type="submit"
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    height="13"
                    viewBox="0 0 24 24"
                    width="13"
                  >
                    <path
                      d="M4 12.5l5 5L20 6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.5"
                    />
                  </svg>
                </button>
                <button
                  aria-label="Cancel"
                  className="showcase-node-cancel"
                  onClick={onCancelNewCollection}
                  title="Discard changes"
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    focusable="false"
                    height="13"
                    viewBox="0 0 24 24"
                    width="13"
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
              </form>
            ) : (
              <div className="collection-title-row">
                <h1>{collection?.name ?? "Notes"}</h1>
              </div>
            )}
            {isCollectionEditing && collectionEditDialog ? collectionEditDialog : null}
            {showingNewCollectionForm ? (
              newCollectionError ? (
                <p className="error-text" role="alert">
                  {newCollectionError}
                </p>
              ) : null
            ) : isCollectionEditing ? (
              collectionEditError ? (
                <p className="error-text" role="alert">
                  {collectionEditError}
                </p>
              ) : null
            ) : null}
          </div>
          <div className="inline-actions">
            {isCollectionEditing ? (
              <>
                <button
                  className="button button-danger"
                  disabled={deletingCollectionEdit}
                  onClick={onDeleteCollectionEdit}
                  type="button"
                >
                  Delete collection
                </button>
                <button
                  className="button"
                  disabled={savingCollectionEdit}
                  onClick={onCancelCollectionEdit}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  disabled={!canSaveCollectionEdit || savingCollectionEdit || loadingCollections}
                  onClick={onSaveCollectionEdit}
                  type="button"
                >
                  {savingCollectionEdit ? "Saving…" : "Save"}
                </button>
              </>
            ) : showingNewCollectionForm ? (
              <>
                <button
                  className="button"
                  disabled={savingNewCollection}
                  onClick={onCancelNewCollection}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  disabled={savingNewCollection}
                  onClick={() => onSaveNewCollection?.()}
                  type="button"
                >
                  {savingNewCollection ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
            {collection && Number.isInteger(collectionId) && !isNewCollection && showEditCollectionAction ? (
              <Link
                aria-label={`Edit ${collection.name} collection`}
                className="icon-link"
                data-shortcut="e"
                title="Edit collection (e)"
                to={CATALOG_ROUTES.collectionEdit(collectionId)}
              >
                Edit
              </Link>
            ) : null}
            <button
              aria-label="Add note"
              className="icon-link button-primary"
              data-shortcut="a"
              disabled={noCollections || isNewCollection}
              onClick={openCreateNote}
              type="button"
            >
              Add note
            </button>
              </>
            )}
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
              <div className="table-search table-search--scoped">
                <svg
                  aria-hidden="true"
                  className="table-search-icon"
                  fill="none"
                  focusable="false"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.9"
                  viewBox="0 0 24 24"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <FilterFieldMenu
                  onChange={(field) => {
                    setFilterField(field);
                    searchInputRef.current?.focus();
                  }}
                  options={[
                    { key: "all", label: filterFieldLabel("all") },
                    ...searchColumns.map((column) => ({
                      key: column.key,
                      label: filterFieldLabel(column.key),
                    })),
                  ]}
                  value={filterField}
                />
                <span aria-hidden="true" className="table-search-divider" />
                <input
                  aria-autocomplete={
                    filterField === tagsColumnKey ? "list" : undefined
                  }
                  aria-controls={
                    tagListVisible ? "table-filter-tag-suggestions" : undefined
                  }
                  aria-expanded={
                    filterField === tagsColumnKey
                      ? tagListVisible
                      : undefined
                  }
                  aria-label={`Filter ${filterFieldLabel(filterField)}`}
                  autoComplete="off"
                  className="table-search-input"
                  onBlur={
                    filterField === tagsColumnKey
                      ? () => closeTagSuggestions()
                      : undefined
                  }
                  onChange={(event) => {
                    setFilterDraft(event.target.value);

                    if (filterField === tagsColumnKey) {
                      openTagSuggestions();
                    }
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={filterPlaceholder}
                  ref={searchInputRef}
                  type="search"
                  value={filterDraft}
                />
                {filterField === tagsColumnKey ? (
                  // The list opens on demand: this chevron sits before the
                  // shortcut and says "press Down to see the suggestions".
                  <button
                    aria-controls={
                      tagListVisible
                        ? "table-filter-tag-suggestions"
                        : undefined
                    }
                    aria-expanded={tagListVisible}
                    aria-haspopup="listbox"
                    aria-label="Show tag suggestions"
                    className={`table-filter-tags-toggle${tagListVisible ? " is-open" : ""}`}
                    onClick={() => {
                      if (tagSuggestionOpen) {
                        closeTagSuggestions();
                      } else {
                        openTagSuggestions();
                      }
                      searchInputRef.current?.focus();
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    tabIndex={-1}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      fill="none"
                      focusable="false"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2.4"
                      viewBox="0 0 24 24"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                ) : null}
                {filterDraft.trim() ? (
                  <span aria-hidden="true" className="table-filter-enter">
                    ⏎ add
                  </span>
                ) : (
                  <kbd className="table-search-hint">/</kbd>
                )}
              </div>
              {tagListVisible
                ? createPortal(
                    <div
                      aria-label="Tag suggestions"
                      className="tags-filter-dropdown"
                      id="table-filter-tag-suggestions"
                      ref={tagSuggestionListRef}
                      role="listbox"
                      style={{
                        top: tagSuggestionPosition.top,
                        left: tagSuggestionPosition.left,
                        width: tagSuggestionPosition.width,
                      }}
                    >
                      {tagMatches.map((tag, index) => (
                        <button
                          aria-selected={index === tagSuggestionIndex}
                          className={`tags-filter-option${index === tagSuggestionIndex ? " is-highlighted" : ""}`}
                          key={tag}
                          onClick={() => pickTagSuggestion(tag)}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() =>
                            setTagSuggestionIndex(index)
                          }
                          ref={
                            index === tagSuggestionIndex
                              ? scrollTagSuggestionIntoView
                              : undefined
                          }
                          role="option"
                          type="button"
                        >
                          <HighlightMatch text={tag} query={trimmedTagDraft} />
                        </button>
                      ))}
                      {!tagMatches.length ? (
                        <div
                          className="muted"
                          style={{ padding: "6px 8px", fontSize: "0.82rem" }}
                        >
                          No matching tags.
                        </div>
                      ) : null}
                    </div>,
                    document.body,
                  )
                : null}
              <div className="table-filter-chips">
                {conditionGroups.length ? (
                  <>
                    {conditionGroups.map(({ field, items }, groupIndex) => (
                      <Fragment key={field}>
                        {groupIndex > 0 ? (
                          <span className="table-filter-and">and</span>
                        ) : null}
                        <span className="table-filter-facet">
                          <span className="table-filter-facet-label">
                            {filterFieldLabel(field)}
                          </span>
                          {items.map((condition, index) => (
                            <Fragment key={condition.id}>
                              {index > 0 ? (
                                <span className="table-filter-or">or</span>
                              ) : null}
                              <span
                                className={`table-filter-chip${condition.negated ? " table-filter-chip--negated" : ""}`}
                              >
                                {editingConditionId === condition.id ? (
                                  <input
                                    aria-label={`Edit ${filterFieldLabel(field)} filter`}
                                    autoFocus
                                    className="table-filter-chip-input"
                                    onBlur={commitConditionEdit}
                                    onChange={(event) =>
                                      setConditionDraft(event.target.value)
                                    }
                                    onFocus={(event) =>
                                      event.currentTarget.select()
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        commitConditionEdit();
                                      } else if (event.key === "Escape") {
                                        event.preventDefault();
                                        cancelConditionEdit();
                                      }
                                    }}
                                    value={conditionDraft}
                                  />
                                ) : (
                                  <>
                                    <button
                                      aria-label={`Edit ${filterFieldLabel(field)} filter ${condition.value}`}
                                      className="table-filter-chip-value"
                                      onClick={() => startConditionEdit(condition)}
                                      title="Edit value"
                                      type="button"
                                    >
                                      {condition.negated ? "!" : ""}
                                      {condition.value}
                                    </button>
                                    <button
                                      aria-label={`Remove ${filterFieldLabel(field)} ${condition.negated ? "not " : ""}${condition.value}`}
                                      className="table-filter-chip-remove"
                                      onClick={() => removeCondition(condition.id)}
                                      type="button"
                                    >
                                      <svg
                                        aria-hidden="true"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeLinecap="round"
                                        strokeWidth="1.6"
                                        viewBox="0 0 12 12"
                                      >
                                        <path d="m2.5 2.5 7 7M9.5 2.5l-7 7" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                              </span>
                            </Fragment>
                          ))}
                        </span>
                      </Fragment>
                    ))}
                    <button
                      className="table-filter-clear-all"
                      onClick={clearAllFilters}
                      type="button"
                    >
                      Clear all
                    </button>
                  </>
                ) : (
                  <span className="table-filter-chips-empty">
                    {
                      "No filters yet — pick a field, type, press ⏎. Same field ORs, different fields AND."
                    }
                  </span>
                )}
              </div>

              <ColumnPicker
                columns={hideableColumns}
                disabledColumnKey={lastVisibleDataColumnKey}
                onToggle={toggleColumnVisibility}
                visibleColumnKeys={visibleColumnKeys}
              />
              <div className="table-reset-slot">
                {canResetView ? (
                  <button
                    className="button"
                    onClick={resetTableState}
                    type="button"
                  >
                    Reset view
                  </button>
                ) : null}
              </div>
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
              <div className="table-viewport">
              <div
                className={`table-scroll-x${columnsDragging ? " is-panning" : ""}${columnsScrolled ? " is-scrolled-x" : ""}`}
                onClickCapture={handleColumnPanClickCapture}
                onLostPointerCapture={handleColumnPanPointerEnd}
                onMouseDown={handleColumnPanMouseDown}
                onPointerCancel={handleColumnPanPointerEnd}
                onPointerDown={handleColumnPanPointerDown}
                onPointerMove={handleColumnPanPointerMove}
                onPointerUp={handleColumnPanPointerEnd}
                onScroll={() => syncColumnScroll()}
                ref={tableScrollRef}
              >
                <div className="table-scroll-content">
                  <table aria-busy={rowsPending || undefined}>
                    <colgroup>
                      {visibleColumns.map((column) => (
                        <col
                          key={column.key}
                          style={{
                            width: `${columnWidths[column.key] ?? column.width ?? 0}px`,
                          }}
                        />
                      ))}
                      {vScroll.visible ? (
                        <col style={{ width: `${tableGutterWidth}px` }} />
                      ) : null}
                    </colgroup>
                    <thead>
                      <tr>
                        {visibleColumns.map((column) => {
                          if (column.kind === "reorder") {
                            return (
                              <th
                                key={column.key}
                                scope="col"
                                {...stickyCellAttributes(
                                  column,
                                  cellClass(column),
                                )}
                              />
                            );
                          }

                          if (column.kind === "selection") {
                            return (
                              <th
                                key={column.key}
                                scope="col"
                                {...stickyCellAttributes(
                                  column,
                                  cellClass(column),
                                )}
                              >
                                <input
                                  aria-label="Select all visible rows"
                                  checked={allVisibleSelected}
                                  onChange={toggleAllVisible}
                                  ref={selectAllRef}
                                  type="checkbox"
                                />
                              </th>
                            );
                          }

                          if (!column.sortable) {
                            // The actions column carries no visible label: the
                            // three-dot button explains itself. Keep the name
                            // for assistive tech so the column is not anonymous.
                            const isActions = column.kind === "actions";

                            return (
                              <th
                                className={[
                                  alignmentClass(column),
                                  column.isTags ? "tags-column" : null,
                                ]
                                  .filter(Boolean)
                                  .join(" ")}
                                aria-label={isActions ? column.label : undefined}
                                key={column.key}
                                scope="col"
                                {...stickyCellAttributes(
                                  column,
                                  cellClass(column),
                                )}
                              >
                                {isActions ? null : column.label}
                              </th>
                            );
                          }

                          const isSorted = sortKey === column.key;
                          const className = cellClass(column);

                          return (
                            <th
                              aria-sort={
                                isSorted
                                  ? sortDirection === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : "none"
                              }
                              className={className}
                              key={column.key}
                              scope="col"
                              {...stickyCellAttributes(
                                column,
                                column.isTags ? "tags-column" : undefined,
                              )}
                              key={column.key}
                              scope="col"
                              {...stickyCellAttributes(
                                column,
                                column.isTags ? "tags-column" : undefined,
                              )}
                            >
                              <button
                                className={`sort-button${isSorted ? " sort-button--active" : ""}`}
                                onClick={() => toggleSort(column.key)}
                                type="button"
                              >
                                {column.label}
                                {/* Drawn on every sortable header: the
                                    stylesheet keeps it hidden until hover and
                                    lets the sorted column keep it visible. */}
                                <svg
                                  aria-hidden="true"
                                  className="sort-chevron"
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
                            </th>
                          );
                        })}
                        {vScroll.visible ? (
                          <th
                            aria-hidden="true"
                            className="table-gutter-cell"
                            scope="col"
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
                              // A filter that matches nothing is the most
                              // travelled error path in the screen: say the
                              // view is empty, not the collection, and put a
                              // recovery next to it.
                              <div className="table-empty-state">
                                <p className="table-empty-title">
                                  No notes match the active filters.
                                </p>
                                <div className="table-empty-actions">
                                  {hasActiveFilters ? (
                                    <button
                                      className="button"
                                      onClick={clearAllFilters}
                                      type="button"
                                    >
                                      Clear filters
                                    </button>
                                  ) : null}
                                </div>
                                <p className="table-empty-hint">
                                  A chip filters one field. Same field values
                                  are ORed; different fields are ANDed.
                                </p>
                              </div>
                            ) : (
                              "No notes are stored yet in this collection."
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
                        const showPlaceholderBefore =
                          dropTarget?.noteId === note.id &&
                          dropTarget.placement === "before";
                        const showPlaceholderAfter =
                          dropTarget?.noteId === note.id &&
                          dropTarget.placement === "after";
                        const rowMarks = hasActiveFilters
                          ? marksForNote(note, conditions, searchColumns)
                          : null;

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
                              className={`table-row-link${virtualRow.index % 2 === 1 ? " table-row-link--zebra" : ""}${draggedNoteId === note.id ? " table-row-link--dragging" : ""}${selectedIdSet.has(note.id) ? " table-row-link--selected" : ""}${activeNoteId === note.id ? " table-row-link--active" : ""}`}
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
                                    pendingRowCheckboxFocusNoteIdRef.current ===
                                    note.id
                                  ) {
                                    pendingRowCheckboxFocusNoteIdRef.current =
                                      null;
                                    focusRowControlInElement(
                                      element,
                                      note.id,
                                      'input[type="checkbox"]',
                                    );
                                  } else if (
                                    pendingRowActionsFocusNoteIdRef.current ===
                                    note.id
                                  ) {
                                    pendingRowActionsFocusNoteIdRef.current =
                                      null;
                                    focusRowControlInElement(
                                      element,
                                      note.id,
                                      'button[aria-haspopup="menu"]',
                                    );
                                  } else if (
                                    pendingRowFocusNoteIdRef.current === note.id
                                  ) {
                                    const armSelectionTab =
                                      pendingRowKeyboardFocusArmRef.current ===
                                      note.id;

                                    pendingRowFocusNoteIdRef.current = null;
                                    pendingRowKeyboardFocusArmRef.current =
                                      null;
                                    focusRowControlInElement(
                                      element,
                                      note.id,
                                      null,
                                    );

                                    if (armSelectionTab) {
                                      selectionTabArmedRef.current = true;
                                    }
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
                                // The selection bar belongs to the row's tab
                                // cycle, so moving focus into it keeps the
                                // cursor (and the bar's exit target) alive.
                                const toBulkBar =
                                  event.relatedTarget instanceof Element &&
                                  event.relatedTarget.closest(
                                    ".table-bulk-bar",
                                  );
                                // Opening the sidebar with "b" keeps the row
                                // cursor lit, so the page still shows where
                                // the keyboard was while the rail is open.
                                const toSidebar =
                                  event.relatedTarget instanceof Element &&
                                  Boolean(
                                    event.relatedTarget.closest("#app-sidebar"),
                                  );

                                if (
                                  !toBulkBar &&
                                  !toSidebar &&
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
                                  current?.noteId === note.id ? null : current,
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
                              onClick={(event) => {
                                // Controls inside the row (the checkbox, drag
                                // handle, links and the actions button) handle
                                // their own activation. A click that reaches
                                // the row itself, or one of its plain cells,
                                // opens the note.
                                if (
                                  event.target.closest(
                                    "a, button, input, select, textarea",
                                  )
                                ) {
                                  return;
                                }

                                openSlideshow(note.id);
                              }}
                              onKeyDown={(event) => {
                                // Space toggles the row's selection, like the
                                // checkbox it shares a row with. On the
                                // denomination link it would otherwise scroll
                                // the table, and on the actions button it
                                // would open the menu. The checkbox already
                                // toggles itself, and other controls such as
                                // tag chips keep their own Space activation.
                                if (event.key === " ") {
                                  if (
                                    event.target instanceof HTMLInputElement &&
                                    event.target.type === "checkbox"
                                  ) {
                                    return;
                                  }

                                  const isRow =
                                    event.target === event.currentTarget;
                                  const isSourceLink =
                                    event.target instanceof HTMLAnchorElement;
                                  const isActionsButton =
                                    event.target instanceof Element &&
                                    event.target.closest('[aria-haspopup="menu"]');

                                  if (!isRow && !isSourceLink && !isActionsButton) {
                                    return;
                                  }

                                  event.preventDefault();
                                  toggleNote(note.id);
                                  return;
                                }

                                // Enter on a control inside the row (the
                                // denomination link, the actions button)
                                // activates that control. Only the row itself
                                // opens the slideshow here; a row checkbox is
                                // handled by the table's window handler.
                                if (event.target !== event.currentTarget) {
                                  return;
                                }

                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  openSlideshow(note.id);
                                }
                              }}
                              tabIndex={0}
                            >
                              {visibleColumns.map((column) =>
                                renderTableCell(
                                  column,
                                  note,
                                  frontThumb,
                                  rowMarks,
                                ),
                              )}
                              {vScroll.visible ? (
                                <td
                                  aria-hidden="true"
                                  className="table-gutter-cell"
                                />
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
              {selectedIds.length ? (
                <div
                  aria-label="Selection actions"
                  className="table-bulk-bar"
                  onKeyDown={handleBulkBarKeyDown}
                  ref={bulkBarRef}
                  role="region"
                >
                  <span className="table-bulk-bar-count">
                    {selectedIds.length} selected
                  </span>
                  <span
                    aria-hidden="true"
                    className="table-bulk-bar-separator"
                  />
                  <button
                    className="table-bulk-bar-delete"
                    disabled={bulkLoading}
                    onClick={handleBulkDelete}
                    type="button"
                  >
                    {bulkLoading ? "Working..." : "Delete"}
                  </button>
                  <button
                    aria-label="Clear selection"
                    className="table-bulk-bar-clear"
                    onClick={clearSelection}
                    title="Clear selection"
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      focusable="false"
                      height="13"
                      viewBox="0 0 24 24"
                      width="13"
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
              ) : null}
            </div>
            <div className="table-footer-hint">
              <span className="table-footer-summary">
                Showing {deferredOrderedNotes.length} of {notes.length} notes ·
                sorted by {getTableColumn(sortKey)?.label ?? "#"}{" "}
                {sortDirection === "asc" ? "ascending" : "descending"}
                {showSelection && selectedIds.length
                  ? ` · ${selectedIds.length} selected`
                  : ""}
              </span>
              <span className="table-footer-right">
                {reorderLoading ? (
                  <span className="table-footer-status">
                    Saving manual order...
                  </span>
                ) : null}
                <span className="table-footer-keys">
                  Drag the handle to reorder · <kbd>&uarr;</kbd>{" "}
                  <kbd>&darr;</kbd> to browse · <kbd>?</kbd> shortcuts
                </span>
              </span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export { NotesTable };
