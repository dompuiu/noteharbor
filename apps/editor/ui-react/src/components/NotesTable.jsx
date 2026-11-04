import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  TABLE_RAIL_SELECTOR,
} from "../lib/editableElement.js";
import { collectionDeleteConfirmation } from "../lib/collectionActions.js";
import { isEmptyLibrary } from "../lib/libraryState.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
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
  slideshowFilterKeys,
  stickyOffsets,
  tableColumns,
  tableColumnWidths,
  tagsColumnKey,
  validSortKeys,
} from "../lib/tableColumns.js";
import { buildNoteRowModel } from "../lib/noteRowModel.js";
import {
  cellClass,
  noteThumbnailPath,
  stickyCellAttributes,
} from "../lib/tableCells.jsx";
import { conditionsFromInput, makeCondition } from "../lib/tableFilters.js";
import { ColumnPicker } from "./ColumnPicker.jsx";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { NoteEditForm } from "./NoteEditForm.jsx";
import { NoCollectionsPrompt } from "./NoCollectionsPrompt.jsx";
import { RowActionsMenu } from "./RowActionsMenu.jsx";
import { Slideshow } from "./Slideshow.jsx";
import { TableFilterBar } from "./TableFilterBar.jsx";
import { TableRows } from "./TableRows.jsx";
import { TableBulkBar } from "./TableBulkBar.jsx";
import { TableMoveToast } from "./TableMoveToast.jsx";
import { MoveNotesDialog } from "./MoveNotesDialog.jsx";
import { TableScrollbar } from "./TableScrollbar.jsx";

export function HomeHero() {
  return null;
}

const rowHeightEstimate = 45;
// Mirrors the table's CSS min-width and the trailing scrollbar-gutter column.
const minTableWidth = 1200;
const tableGutterWidth = 14;
const validPreviewKinds = new Set(["front", "back"]);
const slideshowFilterParamPrefix = "f_";

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
function dropNotesAndRenumber(noteList, removedIds) {
  const removed = new Set(removedIds);

  if (!removed.size) {
    return noteList;
  }

  const removedOrders = noteList
    .filter((note) => removed.has(note.id))
    .map((note) => note.display_order)
    .filter((order) => order != null);
  const remaining = noteList.filter((note) => !removed.has(note.id));

  if (!removedOrders.length) {
    return remaining;
  }

  return remaining.map((note) => {
    if (note.display_order == null) {
      return note;
    }

    const shift = removedOrders.filter(
      (removedOrder) => removedOrder < note.display_order,
    ).length;

    return shift ? { ...note, display_order: note.display_order - shift } : note;
  });
}

function dropNoteAndRenumber(noteList, removedId) {
  return dropNotesAndRenumber(noteList, [removedId]);
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
  onRenameCollection = null,
  onDeleteCollection = null,
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
  // Drag feedback lives in the rows (see TableRows.jsx), which are its only
  // writer; this ref mirrors it synchronously so the shell's edge auto-scroll
  // can ask whether a note is in the air without a table render.
  const dragStateRef = useRef({ draggedNoteId: null, dropTarget: null });
  const tableScreenRef = useRef(null);
  const tableShellRef = useRef(null);
  const tableScrollRef = useRef(null);
  // The memoized rows receive one stable handlers object; its members call
  // through this ref so they always read the current render's state without
  // changing identity.
  const rowHandlerImplRef = useRef(null);
  const [tableWidth, setTableWidth] = useState(null);
  const columnPanRef = useRef(null);
  const suppressColumnPanClickRef = useRef(false);
  const editorOverlayRef = useRef(null);
  const focusedRowIdRef = useRef(null);
  const tableFocusAnchorRef = useRef(null);
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
  const hadConditionsRef = useRef(conditions.length > 0);
  // The filter bar owns its draft and field; this ref is only the table's way
  // to focus it (the `/` shortcut) or reset it (Reset view, collection switch).
  const filterBarRef = useRef(null);
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
  // The move toast owns its message and timer; the table only tells it when to
  // show one.
  const moveToastRef = useRef(null);
  // The one Move dialog, opened by the bulk bar or a row menu. It holds the
  // notes as an ordered list, because a bulk move keeps the order the
  // collector sees in the table.
  const [moveRequest, setMoveRequest] = useState(null);
  // A hand-off from another table (a move or create that redirected here):
  // shown once the destination's notes load, then forgotten.
  const pendingHighlightNoteIdRef = useRef(null);

  // A move or a create that switched collections lands here with a one-shot
  // hand-off: the toast to show on this table, and the note to reveal. It also
  // reopens the destination fresh: default sort, no filters, no search. The
  // route state is cleared at once so a refresh or a back-navigation does not
  // replay it.
  const handoffState = location.state;
  useEffect(() => {
    if (!handoffState) {
      return;
    }

    if (handoffState.toast) {
      moveToastRef.current?.show(handoffState.toast);
    }

    pendingHighlightNoteIdRef.current = handoffState.highlightNoteId ?? null;

    const defaults = defaultTableState();
    setTableView((current) => ({
      ...current,
      sortKey: defaults.sortKey,
      sortDirection: defaults.sortDirection,
    }));

    navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: null,
    });
    // The state is consumed exactly once; the navigation itself is not a
    // reason to run again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffState]);

  const canMoveNotes =
    Array.isArray(collections) && collections.length > 1;
  const [loading, setLoading] = useState(true);
  // Bumped by the load-error panel's Try again. It is the effect's only
  // manual trigger: collection switches and the first mount change the other
  // dependencies.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [thumbPreviewState, setThumbPreviewState] = useState(null);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [columnFilterHeights, setColumnFilterHeights] = useState({});
  // The scrollbar owns its metrics; the table only needs to know whether its
  // gutter column is showing, which changes the column widths.
  const [vScrollVisible, setVScrollVisible] = useState(false);
  // The horizontal scrollbar is hidden (the Flutter table does the same), so
  // the footer offers the arrow keys whenever the columns really overflow.
  const [columnPanAvailable, setColumnPanAvailable] = useState(false);
  const selectAllRef = useRef(null);
  const editorDirtyRef = useRef(false);
  const confirmOpenRef = useRef(false);
  const closeEditorRef = useRef(null);
  const collectionNameFieldRef = useRef(null);
  // Inline collection rename in the view header. Edit mode keeps its own
  // draft and form props; this state is only ever used from the view route.
  const [renamingCollection, setRenamingCollection] = useState(false);
  const [collectionRenameDraft, setCollectionRenameDraft] = useState("");
  const [collectionActionError, setCollectionActionError] = useState("");
  const [savingCollectionRename, setSavingCollectionRename] = useState(false);
  const collectionRenameFieldRef = useRef(null);
  const collectionTitleButtonRef = useRef(null);
  const collectionRenameErrorId = useId();
  const wasRenamingCollectionRef = useRef(false);
  const {
    confirm: requestConfirmation,
    dialog: confirmDialog,
    isOpen: confirmOpen,
  } = useConfirmation();
  confirmOpenRef.current = confirmOpen;
  const handleEditorDirtyChange = useCallback((dirty) => {
    editorDirtyRef.current = dirty;
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

  // Inline rename lands the cursor in the title field, selected, so the name
  // can be retyped at once. `e` from the table opens this same state.
  useEffect(() => {
    if (!renamingCollection) {
      return;
    }

    const field = collectionRenameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [renamingCollection]);

  // Closing the field hands focus back to the title: saving, cancelling and a
  // dismissed confirm all unmount the control that had focus.
  useEffect(() => {
    if (wasRenamingCollectionRef.current && !renamingCollection) {
      collectionTitleButtonRef.current?.focus();
    }

    wasRenamingCollectionRef.current = renamingCollection;
  }, [renamingCollection]);

  // A collection switch abandons an open rename: its draft belongs to the
  // collection that was on screen.
  useEffect(() => {
    setRenamingCollection(false);
    setCollectionRenameDraft("");
    setCollectionActionError("");
  }, [collectionId]);

  function startCollectionRename() {
    if (!collection || !onRenameCollection) {
      return;
    }

    setRenamingCollection(true);
    setCollectionRenameDraft(collection.name);
    setCollectionActionError("");
  }

  function cancelCollectionRename() {
    if (savingCollectionRename) {
      return;
    }

    setRenamingCollection(false);
    setCollectionRenameDraft("");
    setCollectionActionError("");
  }

  async function submitCollectionRename(event) {
    event.preventDefault();

    if (!collection || !onRenameCollection || savingCollectionRename) {
      return;
    }

    const trimmed = collectionRenameDraft.trim();

    if (!trimmed) {
      setCollectionActionError("A collection name is required.");
      return;
    }

    if (trimmed === collection.name) {
      cancelCollectionRename();
      return;
    }

    setSavingCollectionRename(true);
    setCollectionActionError("");

    try {
      await onRenameCollection(trimmed);
      setRenamingCollection(false);
      setCollectionRenameDraft("");
    } catch (error) {
      setCollectionActionError(
        error?.message || "Could not rename the collection.",
      );
    } finally {
      setSavingCollectionRename(false);
    }
  }

  function handleCollectionRenameKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelCollectionRename();
    }
  }

  async function handleDeleteCollectionAction() {
    if (!collection || !onDeleteCollection) {
      return;
    }

    setCollectionActionError("");

    const confirmed = await requestConfirmation(
      collectionDeleteConfirmation(collection.name),
    );

    if (!confirmed) {
      collectionTitleButtonRef.current?.focus();
      return;
    }

    try {
      await onDeleteCollection();
    } catch (error) {
      setCollectionActionError(
        error?.message || "Could not delete the collection.",
      );
    }
  }

  const collectionActionItems = [
    onRenameCollection
      ? {
          key: "rename",
          label: "Rename",
          icon: "edit",
          onSelect: startCollectionRename,
        }
      : null,
    onDeleteCollection
      ? {
          key: "delete",
          label: "Delete collection…",
          icon: "delete",
          danger: true,
          separated: Boolean(onRenameCollection),
          onSelect: handleDeleteCollectionAction,
        }
      : null,
  ].filter(Boolean);

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
  // A note handed over by a move or create in another collection is revealed
  // once this table's own list has landed.
  useEffect(() => {
    const noteId = pendingHighlightNoteIdRef.current;

    if (noteId == null || loading) {
      return;
    }

    if (orderedNotes.some((note) => note.id === noteId)) {
      pendingHighlightNoteIdRef.current = null;
      focusRowByNoteId(noteId);
    }
    // `focusRowByNoteId` reads the list of the render it runs in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orderedNotes]);
  // The painted row list lags one step behind the filter state: inputs,
  // chips, and counts stay instant while the heavy row re-mount happens in
  // a background render. Everything that reads note *identity* (selection,
  // nav, slideshow) keeps using the urgent list.
  // The painted row list and the marks that explain it lag one step behind the
  // filter state, together: input, chips and counts stay instant while the
  // heavy row re-mount happens in a background render. Deferring them as one
  // value keeps a commit to a single repaint of the new row set.
  const paintedView = useMemo(
    () => ({ conditions, notes: orderedNotes }),
    [conditions, orderedNotes],
  );
  const deferredView = useDeferredValue(paintedView);
  const deferredOrderedNotes = deferredView.notes;
  const deferredConditions = deferredView.conditions;
  const rowsPending = deferredView !== paintedView;
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
  }, [collectionId, loadingCollections, loadAttempt]);

  function retryNotesLoad() {
    setLoadAttempt((attempt) => attempt + 1);
  }

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
    filterBarRef.current?.reset();
  }, [collectionId]);

  useEffect(() => {
    // Clearing the filters brings the whole table back: return the columns to
    // their start edge so the collector sees the widest table, not the pan
    // position that belonged to the filtered view.
    if (hadConditionsRef.current && !conditions.length) {
      resetColumnScroll();
    }

    hadConditionsRef.current = conditions.length > 0;
  }, [conditions]);

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
        vScrollVisible ? tableGutterWidth : 0,
      ),
    [visibleColumns, tableWidth, vScrollVisible],
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
    (vScrollVisible ? 1 : 0);
  const isDefaultOrder =
    sortKey === defaultSortKey && sortDirection === "asc";
  // Follow the painted view: flipping the drag handles off in the urgent
  // render would repaint every old row before the filtered list lands. This is
  // the view fact behind the grips: does the current view have a manual order
  // to show at all?
  const reorderRail = !deferredConditions.length && isDefaultOrder;
  // A save in flight only stops the grips from taking a drop; it must not
  // unmount them, or every reorder would blank the whole reorder rail for the
  // length of the round trip.
  const canReorder = reorderRail && !reorderLoading;
  // The footer names the reorder action only while the grips are on screen.
  // When the view has no manual order to show, it names what is in the way
  // instead of pointing at handles that are not there. An empty view has
  // nothing to reorder, so it names nothing at all, whatever the sort.
  const reorderHint = !deferredOrderedNotes.length
    ? null
    : reorderRail
      ? "Drag the handle to reorder"
      : deferredConditions.length
        ? "Clear filters to reorder"
        : `Sort by ${getTableColumn(defaultSortKey)?.label ?? "#"} ascending to reorder`;

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
    // Rows are one line and never wrap, so their height is fixed. Without
    // dynamic measurement the offsets are pure arithmetic, which lets the
    // virtualizer skip the synchronous render on every scroll tick.
    estimateSize: () => rowHeightEstimate,
    getScrollElement: () => tableScrollRef.current,
    overscan: 4,
    useFlushSync: false,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const topSpacerHeight = virtualRows.length ? virtualRows[0].start : 0;
  const bottomSpacerHeight = virtualRows.length
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
    : 0;

  // Per-note row models are built once for the whole painted list, not once
  // per row per commit. Their identities only change when the notes, the
  // column geometry or the filter change, so an unrelated re-render leaves
  // every row's props alone.
  const rowModelsByNoteId = useMemo(() => {
    const map = new Map();

    for (const note of deferredOrderedNotes) {
      map.set(
        note.id,
        buildNoteRowModel({
          columnWidths,
          columns: visibleColumns,
          lastStickyColumnKey,
          marks: deferredConditions.length
            ? marksForNote(note, deferredConditions, searchColumns)
            : null,
          note,
          stickyLeftByColumn,
        }),
      );
    }

    return map;
  }, [
    columnWidths,
    deferredConditions,
    deferredOrderedNotes,
    lastStickyColumnKey,
    searchColumns,
    stickyLeftByColumn,
    visibleColumns,
  ]);

  const rowHandlers = useMemo(() => {
    const invoke = (name) => (...args) =>
      rowHandlerImplRef.current?.[name]?.(...args);

    // Drag-and-drop feedback is added by TableRows.jsx, which owns it.
    return {
      onActionsRef: invoke("onActionsRef"),
      onApplyTagFilter: invoke("onApplyTagFilter"),
      onCopyNote: invoke("onCopyNote"),
      onDeleteNote: invoke("onDeleteNote"),
      onEditNote: invoke("onEditNote"),
      onInsertNoteAfter: invoke("onInsertNoteAfter"),
      onMoveNote: invoke("onMoveNote"),
      onOpenNote: invoke("onOpenNote"),
      onRowBlur: invoke("onRowBlur"),
      onRowClick: invoke("onRowClick"),
      onRowElement: invoke("onRowElement"),
      onRowFocus: invoke("onRowFocus"),
      onRowKeyDown: invoke("onRowKeyDown"),
      onRowMouseDown: invoke("onRowMouseDown"),
      onRowMouseUp: invoke("onRowMouseUp"),
      onThumbElement: invoke("onThumbElement"),
      onThumbEnter: invoke("onThumbEnter"),
      onThumbLeave: invoke("onThumbLeave"),
      onToggleSelection: invoke("onToggleSelection"),
    };
  }, []);

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
      setTableWidth((current) => (current === nextWidth ? current : nextWidth));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [loading, loadError]);

  // The scroller's content width is the sum of the rendered <col> widths, so
  // the table only needs re-checking when those widths change (a resize, a
  // column toggle, or the scrollbar's gutter) or when the scroller remounts
  // with the rows. Same overflow test as columnScroller(), so the footer only
  // offers the arrows when pressing them would actually move the table.
  useLayoutEffect(() => {
    const scroller = tableScrollRef.current;

    if (!scroller) {
      return;
    }

    const overflows = scroller.scrollWidth > scroller.clientWidth + 1;
    setColumnPanAvailable((current) =>
      current === overflows ? current : overflows,
    );
  }, [columnWidths, loading, loadError, vScrollVisible]);

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

  // The pinned block's edge shadow and the pan's grabbing cursor are painted on
  // the scroller itself (see .is-scrolled-x and .is-panning in styles.css).
  // They are pure scroll and gesture state, so writing the class directly keeps
  // a pan from rebuilding the note rows or the header. The class is also kept
  // in sync from the scroller's scroll event, because a scroll can arrive from
  // a wheel, a trackpad or a keyboard pan without passing through here.
  //
  // The pinned cells themselves need no scroll offset: .table-scroll-x is the
  // scrollport for both axes, so native sticky keeps them fixed while the
  // columns pan.
  function syncColumnScroll(scroller = tableScrollRef.current) {
    scroller?.classList.toggle(
      "is-scrolled-x",
      isColumnPanShadowVisible(scroller.scrollLeft ?? 0),
    );
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
      scroller.classList.add("is-panning");

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
    tableScrollRef.current?.classList.remove("is-panning");
  }

  function handleColumnPanClickCapture(event) {
    if (!suppressColumnPanClickRef.current) {
      return;
    }

    suppressColumnPanClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // A window switch mid-pan never delivers pointerup to the scroller, and the
  // capture can outlive the gesture. End the pan on blur so the grabbing
  // cursor and the suppressed text selection cannot stick. The handler only
  // touches refs, so the first render's copy stays correct.
  useEffect(() => {
    function endPanOnBlur() {
      if (columnPanRef.current) {
        handleColumnPanPointerEnd();
      }
    }

    window.addEventListener("blur", endPanOnBlur);
    return () => window.removeEventListener("blur", endPanOnBlur);
  }, []);

  useEffect(() => {
    if (!thumbPreviewState) {
      return undefined;
    }

    const scroller = tableScrollRef.current;

    if (!scroller) {
      return undefined;
    }

    // The preview hangs beside the thumbnail. It is 138px tall against a 45px
    // row, so it is nudged up or down to stay inside the rows area instead of
    // running under the header or past the last row. It is one portal-hosted
    // bubble for the whole table, not a hidden node in every row.
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
      const previewWidth = 226;
      const desiredTop =
        thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
      const minTop = Math.max(scrollerBounds.top + 8, headerBottom + 8);
      const maxTop = scrollerBounds.bottom - previewHeight - 8;
      const top = Math.round(Math.min(Math.max(desiredTop, minTop), maxTop));
      const left = Math.round(
        Math.min(thumbBounds.right + 12, window.innerWidth - previewWidth - 8),
      );

      setThumbPreviewState((current) =>
        current && current.noteId === thumbPreviewState.noteId
          ? current.top === top && current.left === left
            ? current
            : { ...current, top, left }
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
      // keep their own keys, and modal surfaces own every key. The rail is
      // chrome too: it holds the view controls, not row content, so Escape
      // there keeps reaching the table even though it lives on the card.
      if (isPageBackgroundTarget(target)) {
        return true;
      }

      return (
        target instanceof Element &&
        Boolean(tableScreenRef.current?.contains(target)) &&
        (!tableShellRef.current?.contains(target) ||
          Boolean(target.closest(TABLE_RAIL_SELECTOR))) &&
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
        filterBarRef.current?.focus();
        return;
      }

      // Esc closes an inline rename even after focus moved out of its field.
      // The field itself handles the press while focused, before this runs.
      // Mid-save, the request wins: the name is already on its way.
      if (event.key === "Escape" && renamingCollection) {
        if (savingCollectionRename) {
          return;
        }

        event.preventDefault();
        setRenamingCollection(false);
        setCollectionRenameDraft("");
        setCollectionActionError("");
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
      // on (or inside) one, otherwise it falls back to the rail's Add note
      // action so the shortcut still works from an empty focus state or right
      // after the row cursor was cleared. This matches the row menu's
      // "Insert note below" item, which advertises the same shortcut.
      if (event.key === "a") {
        // An empty library has no collection to create a note in. The Add
        // note button is disabled; the shortcut has to match it. A not-yet-saved
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
          !isCollectionEditing &&
          !renamingCollection &&
          onRenameCollection
        ) {
          event.preventDefault();
          setRenamingCollection(true);
          setCollectionRenameDraft(collection.name);
          setCollectionActionError("");
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
    onRenameCollection,
    orderedNotes,
    renamingCollection,
    rowVirtualizer,
    savingCollectionRename,
    slideshowRouteActive,
    showShortcutsHelp,
  ]);

  function handleConditionsChange(next) {
    setConditions(next);
  }

  function focusFirstRow() {
    const first = orderedNotes[0];

    if (first) {
      focusRowByNoteId(first.id);
    }
  }

  function focusLastRow() {
    const last = orderedNotes[orderedNotes.length - 1];

    if (last) {
      focusRowByNoteId(last.id);
    }
  }

  function resetTableState() {
    setConditions([]);
    filterBarRef.current?.reset();
    // Columns are structure, not view state: Reset view restores the default
    // order but leaves the collector's column choice alone.
    const defaults = defaultTableState();
    setTableView((current) => ({
      ...current,
      sortKey: defaults.sortKey,
      sortDirection: defaults.sortDirection,
    }));
    setSelectedIds([]);
  }

  function clearAllFilters() {
    setConditions([]);
  }

  function removeFieldConditions(field) {
    setConditions((current) =>
      current.filter((condition) => condition.field !== field),
    );
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
    setThumbPreviewState({ noteId, top: null, left: null });
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

    // A hidden column must not keep hiding rows: drop its chips with it. The
    // filter bar notices the field left its options and falls back to default.
    removeFieldConditions(key);

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
      filterBarRef.current?.focus();
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
    const pageSize = Math.max(
      1,
      Math.floor((scroller.clientHeight - headerHeight) / rowHeightEstimate),
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

  function handleSaveEditedNote(
    updatedNote,
    reorderedNotes,
    movedToCollection,
    intent = "return",
    toastMessage = null,
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
      moveToastRef.current?.show(
        toastMessage ?? `Moved to ${movedToCollection.name}.`,
      );
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

  function openMoveDialog(noteIds) {
    if (!canMoveNotes || !noteIds.length) {
      return;
    }

    setActionError("");
    setMoveRequest({ noteIds });
  }

  function openMoveForSelection() {
    // The dialog moves the selection in the order the table shows it, not in
    // the order the checkboxes were ticked.
    const selected = new Set(selectedIdsRef.current);
    openMoveDialog(
      orderedNotes
        .filter((note) => selected.has(note.id))
        .map((note) => note.id),
    );
  }

  function openMoveForNote(noteId) {
    openMoveDialog([noteId]);
  }

  // A move that stays on this table: the rows are gone, so the selection goes
  // with them, and the toast names the destination. A same-collection no-op
  // passes no ids, so nothing leaves the table.
  function handleMoveStayed(message, movedIds = []) {
    if (movedIds.length) {
      // Renumber like a delete: the backend closes the source gap, so the ID
      // column must not keep stale values.
      setNotes((current) => dropNotesAndRenumber(current, movedIds));
      setSlideshowNotes((current) =>
        dropNotesAndRenumber(current, movedIds),
      );
    }

    clearSelection();

    if (message) {
      moveToastRef.current?.show(message);
    }
  }

  function autoScrollTableShell(event) {
    const shell = tableShellRef.current;
    const scroller = tableScrollRef.current;

    if (!shell || !scroller || dragStateRef.current.draggedNoteId === null) {
      return;
    }

    // The rail at the card's top is chrome, not rows: scroll from the
    // scrollport's own edge so a drag across the filters leaves the table
    // still. The bottom edge stays on the shell because the bulk bar floats
    // over the scrollport there.
    const top = scroller.getBoundingClientRect().top;
    const bottom = shell.getBoundingClientRect().bottom;
    const threshold = 56;
    const maxStep = 24;

    if (event.clientY >= top && event.clientY < top + threshold) {
      const ratio = (top + threshold - event.clientY) / threshold;
      scroller.scrollTop -= Math.ceil(maxStep * Math.min(1, ratio));
    } else if (event.clientY > bottom - threshold) {
      const ratio = (event.clientY - (bottom - threshold)) / threshold;
      scroller.scrollTop += Math.ceil(maxStep * Math.min(1, ratio));
    }
  }

  // The rows hand the drag back here once the drop lands; they own the
  // placeholder and the preview, so all that is left is the reorder itself.
  async function handleReorder(draggedNoteId, targetNoteId, placement) {
    if (!canReorder || draggedNoteId === null) {
      return;
    }

    const startIndex = notes.findIndex((note) => note.id === draggedNoteId);
    const targetIndex = notes.findIndex((note) => note.id === targetNoteId);

    if (startIndex < 0 || targetIndex < 0) {
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
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

  async function handleBulkDelete(reportWorkStarted) {
    if (!selectedIds.length) {
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

      // From here the rows are going away, so the bar may say it is working.
      reportWorkStarted?.();

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
    }
  }

  async function handleDeleteNote(noteId, { fromSlideshow = false } = {}) {
    const note =
      notes.find((entry) => entry.id === noteId) ??
      slideshowNotes.find((entry) => entry.id === noteId) ??
      null;
    // The row model carries this for every note in the painted list, but a
    // delete opened from the slideshow can name a note a filter has hidden
    // from the table, so the confirmation asks the shared derivation.
    const thumbnail = note ? noteThumbnailPath(note) : null;
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
              // The note's picture is a convenience in a confirmation; a
              // missing file should leave the identity text alone rather than
              // a broken-image glyph.
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
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

  // Header cells share the row cells' pinning contract. The pinning data is
  // the table's, so the header binds it here and the composition itself lives
  // with the rest of the cell classes.
  function tableCellAttributes(column) {
    return stickyCellAttributes(column, cellClass(column), {
      lastStickyColumnKey,
      stickyLeftByColumn,
    });
  }

  function registerRowElement(noteId, element) {
    if (!element) {
      rowElementMapRef.current.delete(noteId);
      return;
    }

    rowElementMapRef.current.set(noteId, element);

    if (pendingRowCheckboxFocusNoteIdRef.current === noteId) {
      pendingRowCheckboxFocusNoteIdRef.current = null;
      focusRowControlInElement(element, noteId, 'input[type="checkbox"]');
    } else if (pendingRowActionsFocusNoteIdRef.current === noteId) {
      pendingRowActionsFocusNoteIdRef.current = null;
      focusRowControlInElement(element, noteId, 'button[aria-haspopup="menu"]');
    } else if (pendingRowFocusNoteIdRef.current === noteId) {
      const armSelectionTab =
        pendingRowKeyboardFocusArmRef.current === noteId;

      pendingRowFocusNoteIdRef.current = null;
      pendingRowKeyboardFocusArmRef.current = null;
      focusRowControlInElement(element, noteId, null);

      if (armSelectionTab) {
        selectionTabArmedRef.current = true;
      }
    } else if (
      focusedRowIdRef.current === noteId &&
      document.activeElement === document.body
    ) {
      // The active row was scrolled out of the virtualized window (unmounting
      // drops focus to <body> with no blur event) and has now remounted:
      // reclaim focus without scrolling, since the user put it here.
      element.focus({ preventScroll: true });
    }
  }

  function handleRowFocus(note) {
    focusedRowIdRef.current = note.id;
    lastRowFocusNoteIdRef.current = note.id;

    if (mouseFocusSuppressRef.current) {
      mouseFocusSuppressRef.current = false;
    } else {
      setActiveNoteId(note.id);
    }
  }

  function handleRowBlur(note, event) {
    // The selection bar belongs to the row's tab cycle, so moving focus into
    // it keeps the cursor (and the bar's exit target) alive.
    const toBulkBar =
      event.relatedTarget instanceof Element &&
      event.relatedTarget.closest(".table-bulk-bar");
    // Opening the sidebar with "b" keeps the row cursor lit, so the page still
    // shows where the keyboard was while the rail is open.
    const toSidebar =
      event.relatedTarget instanceof Element &&
      Boolean(event.relatedTarget.closest("#app-sidebar"));

    if (
      !toBulkBar &&
      !toSidebar &&
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      focusedRowIdRef.current =
        focusedRowIdRef.current === note.id ? null : focusedRowIdRef.current;
      setActiveNoteId((current) =>
        current === note.id ? null : current,
      );
    }
  }

  function handleRowClick(note, event) {
    // Controls inside the row (the checkbox, drag handle, links and the
    // actions button) handle their own activation. A click that reaches the
    // row itself, or one of its plain cells, opens the note.
    if (event.target.closest("a, button, input, select, textarea")) {
      return;
    }

    openSlideshow(note.id);
  }

  function handleRowKeyDown(note, event) {
    // Space toggles the row's selection, like the checkbox it shares a row
    // with. On the denomination link it would otherwise scroll the table, and
    // on the actions button it would open the menu. The checkbox already
    // toggles itself, and other controls such as tag chips keep their own
    // Space activation.
    if (event.key === " ") {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
      ) {
        return;
      }

      const isRow = event.target === event.currentTarget;
      const isSourceLink = event.target instanceof HTMLAnchorElement;
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

    // Enter on a control inside the row (the denomination link, the actions
    // button) activates that control. Only the row itself opens the
    // slideshow here; a row checkbox is handled by the table's window
    // handler.
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openSlideshow(note.id);
    }
  }

  // Rows render from the deferred list while the empty row keys off the urgent
  // one, so for the frame after a filter empties the view both can be on
  // screen. Stretch the table only once both are empty, or that frame would
  // stretch stale rows to the scrollport's height.
  const emptyViewSettled = !orderedNotes.length && !deferredOrderedNotes.length;

  // The empty view is the one body row the screen still owns: it is not a note
  // and it only exists while the list is empty.
  const emptyTableRow = !orderedNotes.length ? (
    <tr className="table-empty-row">
      <td className="table-empty-cell" colSpan={totalColumnCount}>
        {/* The cell spans the whole table, which can be wider than the card
            when the columns overflow. The frame is pinned to the visible
            scrollport so the message centres in what the reader can see, not
            in the off-screen width of the table. */}
        <div className="table-empty-frame">
          {noCollections ? (
            <NoCollectionsPrompt />
          ) : notes.length ? (
            // A filter that matches nothing is the most travelled error path in
            // the screen: say the view is empty, not the collection, and put a
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
                A chip filters one field. Same field values are ORed; different
                fields are ANDed.
              </p>
            </div>
          ) : (
            // An empty collection is a first-run moment, not a failed query:
            // it names itself, offers both ways a note can arrive, and says
            // where the new note will land. The filtered-empty state above
            // explains the filter model instead, so the two never read alike.
            <div className="table-empty-state">
              <p className="table-empty-title">
                No notes in this collection yet.
              </p>
              {!isCollectionEditing && !showingNewCollectionForm ? (
                <div className="table-empty-actions">
                  <button
                    className="button button-primary"
                    onClick={openCreateNote}
                    type="button"
                  >
                    Add the first note
                  </button>
                  <Link className="button" to={CATALOG_ROUTES.importExport}>
                    Import / Export
                  </Link>
                </div>
              ) : null}
              <p className="table-empty-hint">
                A new note lands at the end of the collection's order.
              </p>
            </div>
          )}
        </div>
      </td>
    </tr>
  ) : null;

  rowHandlerImplRef.current = {
    onActionsRef(noteId, instance) {
      if (instance) {
        rowActionsMenuMapRef.current.set(noteId, instance);
      } else {
        rowActionsMenuMapRef.current.delete(noteId);
      }
    },
    onApplyTagFilter: applyTagFilter,
    onCopyNote(note) {
      void handleCopyNoteDetails(note);
    },
    onDeleteNote(noteId) {
      void handleDeleteNote(noteId);
    },
    onEditNote: openEditor,
    onInsertNoteAfter: openCreateNoteAfter,
    onMoveNote: openMoveForNote,
    onOpenNote: openSlideshow,
    onRowBlur: handleRowBlur,
    onRowClick: handleRowClick,
    onRowElement: registerRowElement,
    onRowFocus: handleRowFocus,
    onRowKeyDown: handleRowKeyDown,
    onRowMouseDown() {
      mouseFocusSuppressRef.current = true;
    },
    onRowMouseUp() {
      mouseFocusSuppressRef.current = false;
    },
    onThumbElement(noteId, element) {
      if (element) {
        thumbPreviewElementMapRef.current.set(noteId, element);
      } else {
        thumbPreviewElementMapRef.current.delete(noteId);
      }
    },
    onThumbEnter: showThumbPreview,
    onThumbLeave: hideThumbPreview,
    onToggleSelection: toggleNote,
  };

  return (
    <section className="screen-stack" ref={tableScreenRef}>
      {showShortcutsHelp ? (
        <KeyboardShortcutsHelp onClose={() => setShowShortcutsHelp(false)} />
      ) : null}

      {confirmDialog}

      {thumbPreviewState?.top != null
        ? createPortal(
            <span
              className="table-thumb-preview table-thumb-preview--floating is-visible"
              style={{
                left: thumbPreviewState.left,
                top: thumbPreviewState.top,
              }}
            >
              <img
                alt=""
                onError={() => setThumbPreviewState(null)}
                src={rowModelsByNoteId.get(thumbPreviewState.noteId)?.frontThumb}
              />
            </span>,
            document.body,
          )
        : null}

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
            ) : renamingCollection ? (
              <form
                className="collection-rename-form"
                onSubmit={submitCollectionRename}
              >
                <input
                  aria-describedby={
                    collectionActionError ? collectionRenameErrorId : undefined
                  }
                  aria-invalid={
                    collectionActionError ? true : undefined
                  }
                  aria-label="Collection name"
                  className="showcase-name-field"
                  disabled={savingCollectionRename}
                  onChange={(event) => {
                    setCollectionRenameDraft(event.target.value);
                    setCollectionActionError("");
                  }}
                  onKeyDown={handleCollectionRenameKeyDown}
                  ref={collectionRenameFieldRef}
                  value={collectionRenameDraft}
                />
                <button
                  aria-label="Save name"
                  className="showcase-node-save"
                  disabled={savingCollectionRename}
                  title="Save name (Enter)"
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
                  aria-label="Cancel rename"
                  className="showcase-node-cancel"
                  disabled={savingCollectionRename}
                  onClick={cancelCollectionRename}
                  title="Cancel rename (Esc)"
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
                {collection && onRenameCollection && !isNewCollection ? (
                  // The heading keeps the plain collection name; the button
                  // inside it owns the rename action and its fuller label.
                  <h1 aria-label={collection.name}>
                    <button
                      aria-label={`Rename collection: ${collection.name}`}
                      className="collection-title-button"
                      onClick={startCollectionRename}
                      ref={collectionTitleButtonRef}
                      title="Rename collection (e)"
                      type="button"
                    >
                      {collection.name}
                    </button>
                  </h1>
                ) : (
                  <h1>{collection?.name ?? "Notes"}</h1>
                )}
                {collection &&
                !isNewCollection &&
                (onRenameCollection || onDeleteCollection) ? (
                  <RowActionsMenu
                    items={collectionActionItems}
                    label="Collection actions"
                  />
                ) : null}
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
            ) : collectionActionError ? (
              <p
                className="error-text"
                id={collectionRenameErrorId}
                role="alert"
              >
                {collectionActionError}
              </p>
            ) : null}
          </div>
          {isCollectionEditing ? (
            <div className="inline-actions">
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
            </div>
          ) : showingNewCollectionForm ? (
            <div className="inline-actions">
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
            </div>
          ) : null}
        </div>

        {/* The table's shape holds while the rows are on their way: the card
            stays on screen with the status where the rows will be, so a
            collection switch never collapses the screen and rebuilds it a
            moment later. */}
        {loading || loadingCollections ? (
          <div className="table-shell table-loading">
            <div className="table-loading-body" role="status">
              <p className="table-loading-title">Loading notes…</p>
              <p className="table-loading-detail">
                Reading the notes stored on this device.
              </p>
            </div>
          </div>
        ) : null}
        {collectionsError ? (
          <p className="error-text" role="alert">
            {collectionsError}
          </p>
        ) : null}
        {actionError ? (
          <p className="error-text" role="alert">
            {actionError}
          </p>
        ) : null}
        <TableMoveToast toastRef={moveToastRef} />

        {moveRequest ? (
          <MoveNotesDialog
            collections={collections}
            currentCollectionId={collectionId}
            noteIds={moveRequest.noteIds}
            onClose={() => setMoveRequest(null)}
            onStayed={handleMoveStayed}
          />
        ) : null}

        {loadError ? (
          // A failed load replaces the table with a card the height of the
          // table it stands in for: the screen keeps its shape, the failure
          // names itself, and the recovery is one button away instead of a
          // reload. The live region wraps the copy only, so Try again is not
          // announced as part of the alert.
          <div className="table-shell table-load-error">
            <div className="table-load-error-body">
              <div className="table-load-error-copy" role="alert">
                <h2 className="table-load-error-title">
                  Couldn't load this collection's notes.
                </h2>
                <p className="table-load-error-detail">{loadError}</p>
              </div>
              <p className="table-load-error-note">
                Your notes stay on this device and aren't affected.
              </p>
              <button
                className="button button-primary"
                onClick={retryNotesLoad}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !loadError ? (
          <>
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
              {/* The filters describe only this table, so they are the card's
                  own rail rather than a band above it. The rail sits outside
                  `.table-scroll-x`, so it never pans with the columns and never
                  scrolls away with the rows. */}
              <div className="table-rail">
                <TableFilterBar
                  conditions={conditions}
                  hasRows={deferredOrderedNotes.length > 0}
                  onConditionsChange={handleConditionsChange}
                  onFirstRow={focusFirstRow}
                  ref={filterBarRef}
                  searchColumns={searchColumns}
                  tagNames={tagNames}
                />
                <div className="table-rail-actions">
                  {/* Add note leads the trailing cluster so the primary action
                      is reached before the view controls. Reset then sits
                      before Columns: the pair grows leftwards, Columns keeps
                      the card's right edge whether or not the view is dirty,
                      and no empty slot reserves space for a control that is
                      not there. */}
                  {!isCollectionEditing && !showingNewCollectionForm ? (
                    <button
                      aria-label="Add note"
                      className="button table-add-note"
                      data-shortcut="a"
                      disabled={noCollections || isNewCollection}
                      onClick={openCreateNote}
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        focusable="false"
                        height="15"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        width="15"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      Add note
                    </button>
                  ) : null}
                  {canResetView ? (
                    <button
                      className="button table-reset-view"
                      onClick={resetTableState}
                      title="Clears filters, sort and selection — keeps your columns"
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        fill="none"
                        focusable="false"
                        height="15"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                        viewBox="0 0 24 24"
                        width="15"
                      >
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      Reset view
                    </button>
                  ) : null}
                  <ColumnPicker
                    columns={hideableColumns}
                    disabledColumnKey={lastVisibleDataColumnKey}
                    onToggle={toggleColumnVisibility}
                    visibleColumnKeys={visibleColumnKeys}
                  />
                </div>
              </div>
              <div className="table-viewport">
                <div
                  className="table-scroll-x"
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
                  <div
                    className={`table-scroll-content${emptyViewSettled ? " is-empty-view" : ""}`}
                  >
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
                        {vScrollVisible ? (
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
                                  {...tableCellAttributes(column)}
                                />
                              );
                            }

                            if (column.kind === "selection") {
                              return (
                                <th
                                  key={column.key}
                                  scope="col"
                                  {...tableCellAttributes(column)}
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
                                  aria-label={isActions ? column.label : undefined}
                                  key={column.key}
                                  scope="col"
                                  {...tableCellAttributes(column)}
                                >
                                  {isActions ? null : column.label}
                                </th>
                              );
                            }

                            const isSorted = sortKey === column.key;

                            return (
                              <th
                                aria-sort={
                                  isSorted
                                    ? sortDirection === "asc"
                                      ? "ascending"
                                      : "descending"
                                    : "none"
                                }
                                key={column.key}
                                scope="col"
                                {...tableCellAttributes(column)}
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
                          {vScrollVisible ? (
                            <th
                              aria-hidden="true"
                              className="table-gutter-cell"
                              scope="col"
                            />
                          ) : null}
                        </tr>
                      </thead>
                      <TableRows
                        activeNoteId={activeNoteId}
                        canMove={canMoveNotes}
                        canReorder={canReorder}
                        columns={visibleColumns}
                        dragStateRef={dragStateRef}
                        emptyContent={emptyTableRow}
                        handlers={rowHandlers}
                        notes={deferredOrderedNotes}
                        onReorder={handleReorder}
                        reorderRail={reorderRail}
                        rowElementFor={(noteId) =>
                          rowElementMapRef.current.get(noteId)
                        }
                        rowModelsByNoteId={rowModelsByNoteId}
                        selectedIdSet={selectedIdSet}
                        showGutter={vScrollVisible}
                        topSpacerHeight={topSpacerHeight}
                        bottomSpacerHeight={bottomSpacerHeight}
                        totalColumnCount={totalColumnCount}
                        virtualRows={virtualRows}
                      />
                    </table>
                  </div>
                </div>
                <TableScrollbar
                  loading={loading}
                  onFirstRow={focusFirstRow}
                  onLastRow={focusLastRow}
                  onPage={pageTable}
                  onVisibleChange={setVScrollVisible}
                  rowCount={deferredOrderedNotes.length}
                  rowHeight={rowHeightEstimate}
                  scrollRef={tableScrollRef}
                />
              </div>
              {selectedIds.length ? (
                <TableBulkBar
                  barRef={bulkBarRef}
                  canMove={canMoveNotes}
                  onClear={clearSelection}
                  onDelete={handleBulkDelete}
                  onMove={openMoveForSelection}
                  onLeaveBackward={() => {
                    selectionTabArmedRef.current = false;
                    focusRowActionsButtonByNoteId(bulkBarExitNoteId());
                  }}
                  onLeaveForward={() => {
                    selectionTabArmedRef.current = false;
                    focusRowCheckboxByNoteId(bulkBarExitNoteId());
                  }}
                  selectedCount={selectedIds.length}
                />
              ) : null}
            </div>
            <div className="table-footer-hint">
              {/* The count is the table's answer to every filter keystroke,
                  so it is a polite live region: a screen reader hears the
                  result set change without the table itself being
                  re-announced. It is not `role="status"` so the move toast
                  stays the one status landmark on the screen. */}
              <span
                aria-atomic="true"
                aria-live="polite"
                className="table-footer-summary"
              >
                Showing {deferredOrderedNotes.length} of {notes.length}{" "}
                {notes.length === 1 ? "note" : "notes"} · sorted by{" "}
                {getTableColumn(sortKey)?.label ?? "#"}{" "}
                {sortDirection === "asc" ? "ascending" : "descending"}
                {selectedIds.length
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
                  {/* Each instruction is one segment: they share a line while
                      there is room and stack instead of clipping when the
                      window is narrow. */}
                  {reorderHint ? (
                    <span className="table-footer-segment">{reorderHint}</span>
                  ) : null}
                  {/* With no rows there is nothing for the arrows to walk, so
                      the hint stops offering them and keeps the one key that
                      still does something. */}
                  {deferredOrderedNotes.length ? (
                    <span className="table-footer-segment">
                      <kbd>&uarr;</kbd> <kbd>&darr;</kbd> to browse
                    </span>
                  ) : null}
                  {/* The horizontal scrollbar is hidden, so the columns that
                      sit off-screen are reachable only by dragging or by the
                      arrow keys. The hint appears exactly when that is true. */}
                  {columnPanAvailable ? (
                    <span className="table-footer-segment">
                      <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to pan
                    </span>
                  ) : null}
                  <span className="table-footer-segment">
                    <kbd>?</kbd> shortcuts
                  </span>
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
