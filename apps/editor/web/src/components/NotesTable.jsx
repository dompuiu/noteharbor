import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  deleteNote,
  getNotes,
  getOperationStatus,
  reorderNotes as saveNotesOrder,
  getScrapeStatus,
  startScrape,
} from "../lib/api.js";
import { isScrapingDisabled } from "../lib/appMode.js";
import { copyTextToClipboard, formatNoteAsTsvRow } from "../lib/noteClipboard.js";
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
const tableStateStorageKey = "noteharbor.notesTableState";
const validSortKeys = new Set(["id", ...columns.map(([key]) => key)]);
const rowHeightEstimate = 43;
const validPreviewKinds = new Set(["front", "back"]);

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

function statusIcon(status) {
  switch (status) {
    case "done":
      return "✓";
    case "manual":
      return "●";
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

function imageStatus(note) {
  const images = Array.isArray(note.images) ? note.images : [];

  if (!images.length) {
    return "pending";
  }

  if (images.some((image) => image.origin === "uploaded" || image.origin === "generated")) {
    return "manual";
  }

  if (images.every((image) => image.origin === "scraped")) {
    return "done";
  }

  return "pending";
}

function displayScrapeStatus(note, scrapeJob) {
  if (!scrapeJob) {
    return note.scrape_status === "failed" ? "failed" : imageStatus(note);
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

  return note.scrape_status === "failed" ? "failed" : imageStatus(note);
}

function valueToString(note, key) {
  if (key === "tags") {
    return note.tags.map((tag) => tag.name).join(", ");
  }

  return String(note[key] ?? "");
}

function noteOrderValue(note) {
  const value = Number(note.display_order);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
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
    overlayEdit: false,
    previewKind: null,
  };
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
      overlayEdit: params.get("overlay") === "edit",
      previewKind,
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
    }

    const query = params.toString();
    return `${path}${query ? `?${query}` : ""}`;
  }

  return "";
}

function NotesTable() {
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
  const editorOverlayRef = useRef(null);
  const tagsFilterInputRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

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
  const [operationStatus, setOperationStatus] = useState({
    currentOperation: "idle",
    isBusy: false,
  });
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [slideshowNotes, setSlideshowNotes] = useState([]);
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [thumbPreviewState, setThumbPreviewState] = useState(null);
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
  const currentRoute = useMemo(
    () => parseTableHash(location.hash),
    [location.hash],
  );
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

    return [...filtered].sort((left, right) => {
      if (sortKey === "id") {
        const orderResult = noteOrderValue(left) - noteOrderValue(right);
        const result = orderResult || left.id - right.id;
        return sortDirection === "asc" ? result : -result;
      }

      const leftValue = valueToString(left, sortKey).toLowerCase();
      const rightValue = valueToString(right, sortKey).toLowerCase();
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return sortDirection === "asc" ? result : -result;
    });
  }, [filters, notes, sortDirection, sortKey, visibleColumns]);
  const defaultOrderedNotes = useMemo(
    () =>
      [...notes].sort((left, right) => {
        const orderResult = noteOrderValue(left) - noteOrderValue(right);
        return orderResult || left.id - right.id;
      }),
    [notes],
  );
  const slideshowRouteActive = currentRoute.kind === "slideshow";
  const creatingNote = currentRoute.kind === "create";
  const editingNoteId =
    currentRoute.kind === "edit" || currentRoute.overlayEdit
      ? currentRoute.noteId
      : null;
  const createPositionReferenceId =
    creatingNote && currentRoute.beforeId && notes.some((note) => note.id === currentRoute.beforeId)
      ? currentRoute.beforeId
      : null;
  const createPositionMode = createPositionReferenceId ? "before" : "end";
  const slideshowIndex = slideshowRouteActive
    ? slideshowNotes.findIndex((note) => note.id === currentRoute.noteId)
    : -1;
  const editingNoteIndex = useMemo(() => {
    if (!editingNoteId) {
      return -1;
    }

    return orderedNotes.findIndex((note) => note.id === editingNoteId);
  }, [editingNoteId, orderedNotes]);
  const previousEditingNoteId =
    editingNoteIndex >= 0 && orderedNotes.length > 1
      ? orderedNotes[
          (editingNoteIndex - 1 + orderedNotes.length) % orderedNotes.length
        ].id
      : null;
  const nextEditingNoteId =
    editingNoteIndex >= 0 && orderedNotes.length > 1
      ? orderedNotes[(editingNoteIndex + 1) % orderedNotes.length].id
      : null;
  const currentEditingNotePosition =
    editingNoteIndex >= 0 ? editingNoteIndex + 1 : null;
  const totalNotesInTableView = orderedNotes.length;

  function navigateToTableRoute(nextRoute, { replace = false } = {}) {
    const nextHash = buildTableHash(nextRoute);
    const nextUrl = `${location.pathname}${nextHash}`;
    navigate(nextUrl || "/", { replace });
  }

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
      ? Promise.all([getNotes(), getOperationStatus()]).then(([notesPayload, operationPayload]) => {
          if (active) {
            setNotes(notesPayload.notes);
            setScrapeJob(null);
            setOperationStatus(operationPayload);
          }
        })
      : Promise.all([getNotes(), getScrapeStatus(), getOperationStatus()]).then(
          ([notesPayload, statusPayload, operationPayload]) => {
            if (active) {
              setNotes(notesPayload.notes);
              setScrapeJob(activeScrapeJob(statusPayload));
              setOperationStatus(operationPayload);
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
    if (isScrapingDisabled || (!operationStatus.isBusy && !scrapeJob)) {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      try {
        const [nextStatus, notesPayload, nextOperationStatus] = await Promise.all([
          getScrapeStatus(),
          getNotes(),
          getOperationStatus(),
        ]);
        const nextScrapeJob = activeScrapeJob(nextStatus);

        setNotes(notesPayload.notes);
        setScrapeJob(nextScrapeJob);
        setOperationStatus(nextOperationStatus);
      } catch {
        // Ignore transient polling errors.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [operationStatus.isBusy, scrapeJob]);

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
      if (currentRoute.beforeId && !notes.some((note) => note.id === currentRoute.beforeId)) {
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

    const hasRestoredTableState = Boolean(initialTableStateRef.current);
    const baseNotes =
      initialRouteRef.current.kind === "slideshow" &&
      slideshowNotes.length === 0 &&
      !hasRestoredTableState
        ? defaultOrderedNotes
        : orderedNotes;
    const targetIndex = baseNotes.findIndex((note) => note.id === currentRoute.noteId);

    if (targetIndex < 0) {
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
          overlayEdit: currentRoute.overlayEdit,
          previewKind: null,
        },
        { replace: true },
      );
    }
  }, [
    currentRoute,
    defaultOrderedNotes,
    loading,
    notes,
    orderedNotes,
    slideshowNotes.length,
  ]);

  useEffect(() => {
    if (!editingNoteId && !creatingNote) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        closeEditor();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [creatingNote, editingNoteId]);

  useEffect(() => {
    if (!editingNoteId && !creatingNote) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (editorOverlayRef.current) {
        editorOverlayRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [creatingNote, editingNoteId]);

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

  useEffect(() => {
    if (!thumbPreviewState) {
      return undefined;
    }

    const shell = tableShellRef.current;

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
        shell.querySelector("thead")?.getBoundingClientRect().bottom ?? shellBounds.top;
      const previewHeight = 138;
      const desiredTop = thumbBounds.top + thumbBounds.height / 2 - previewHeight / 2;
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
    shell.addEventListener("scroll", updateThumbPreviewPosition, { passive: true });
    window.addEventListener("resize", updateThumbPreviewPosition);

    return () => {
      shell.removeEventListener("scroll", updateThumbPreviewPosition);
      window.removeEventListener("resize", updateThumbPreviewPosition);
    };
  }, [thumbPreviewState]);

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
    const noteId = startId ?? orderedNotes[0]?.id ?? null;

    if (!noteId) {
      return;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind: null,
    });
  }

  function closeSlideshow() {
    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function openEditor(noteId) {
    setActionError("");

    if (slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId,
        overlayEdit: true,
        previewKind: currentRoute.previewKind,
      });
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

  function closeEditor() {
    if (slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId: currentRoute.noteId,
        overlayEdit: false,
        previewKind: currentRoute.previewKind,
      }, { replace: true });
      return;
    }

    navigateToTableRoute(emptyTableRoute(), { replace: true });
  }

  function resetEditorOverlayScroll() {
    if (editorOverlayRef.current) {
      editorOverlayRef.current.scrollTop = 0;
    }
  }

  function navigateToAdjacentEdit(nextNoteId) {
    if (!nextNoteId) {
      return;
    }

    if (slideshowRouteActive) {
      navigateToTableRoute(
        {
          kind: "slideshow",
          noteId: nextNoteId,
          overlayEdit: true,
          previewKind: currentRoute.previewKind,
        },
        { replace: true },
      );
      return;
    }

    navigateToTableRoute({ kind: "edit", noteId: nextNoteId }, { replace: true });
  }

  function handleSaveEditedNote(updatedNote, reorderedNotes) {
    if (reorderedNotes) {
      setNotes(reorderedNotes);
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
    }

    setSlideshowNotes((current) => {
      if (!current.length) {
        return current;
      }

      let nextSlideshow;

      if (reorderedNotes) {
        const slideshowIds = new Set(current.map((note) => note.id));
        nextSlideshow = reorderedNotes.filter((note) => slideshowIds.has(note.id));
      } else {
        const noteExists = current.some((note) => note.id === updatedNote.id);
        if (!noteExists) return current;
        nextSlideshow = current.map((note) =>
          note.id === updatedNote.id ? updatedNote : note,
        );
      }

      return nextSlideshow;
    });

    if (slideshowRouteActive) {
      navigateToTableRoute({
        kind: "slideshow",
        noteId: updatedNote.id,
        overlayEdit: false,
        previewKind: currentRoute.previewKind,
      }, { replace: true });
      return;
    }

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
      .filter((note) => note.scrape_status === "failed" || imageStatus(note) !== "done")
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

      if (operationStatus.isBusy) {
        throw new Error(
          `Scraping is unavailable while ${String(operationStatus.currentOperation).replace(/_/g, " ")} is in progress.`,
        );
      }

      const payload = await startScrape(selectedIds);
      setOperationStatus({
        currentOperation: "scraping",
        isBusy: true,
        startedAt: new Date().toISOString(),
        details: {
          total: payload.total,
        },
      });
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

    navigateToTableRoute({
      kind: "slideshow",
      noteId: nextNote.id,
      overlayEdit: false,
      previewKind: null,
    });
  }

  function openPreview(noteId, previewKind) {
    if (!validPreviewKinds.has(previewKind)) {
      return;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind,
    });
  }

  function closePreview(noteId) {
    navigateToTableRoute({
      kind: "slideshow",
      noteId,
      overlayEdit: false,
      previewKind: null,
    }, { replace: true });
  }

  function movePreview(offset) {
    if (!slideshowRouteActive || !slideshowNotes.length || !currentRoute.previewKind) {
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
    let nextItemIndex = nextItems.findIndex((kind) => kind === currentRoute.previewKind);

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
        (nextNoteIndex + direction + slideshowNotes.length) % slideshowNotes.length;
      nextItems = ["front", "back"];
      nextItemIndex = direction > 0 ? 0 : nextItems.length - 1;
      remainingSteps -= 1;
    }

    navigateToTableRoute({
      kind: "slideshow",
      noteId: slideshowNotes[nextNoteIndex].id,
      overlayEdit: false,
      previewKind: nextItems[nextItemIndex],
    });
  }

  return (
    <section className="screen-stack">
      {slideshowRouteActive && slideshowNotes.length && slideshowIndex >= 0 ? (
        <Slideshow
          currentIndex={slideshowIndex}
          keyboardDisabled={Boolean(editingNoteId || creatingNote)}
          notes={slideshowNotes}
          onChangeIndex={changeSlideshowIndex}
          onClose={closeSlideshow}
          onCopy={setActionError}
          onEdit={openEditor}
          onOpenPreview={openPreview}
          onClosePreview={closePreview}
          onMovePreview={movePreview}
          previewKind={currentRoute.previewKind}
        />
      ) : null}

      {editingNoteId || creatingNote ? (
        <section
          className="edit-note-overlay"
          ref={editorOverlayRef}
        >
          <div
            className="edit-note-overlay-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <NoteEditForm
              cancelLabel="Close"
              currentNotePosition={currentEditingNotePosition}
              initialPositionMode={createPositionMode}
              initialPositionReferenceId={createPositionReferenceId}
              nextNoteId={nextEditingNoteId}
              noteId={editingNoteId}
              onCancel={closeEditor}
              onNavigateNext={() => navigateToAdjacentEdit(nextEditingNoteId)}
              onNavigatePrevious={() =>
                navigateToAdjacentEdit(previousEditingNoteId)
              }
              onReady={resetEditorOverlayScroll}
              onSaveSuccess={handleSaveEditedNote}
              overlay
              previousNoteId={previousEditingNoteId}
              totalNotesInView={totalNotesInTableView}
            />
          </div>
        </section>
      ) : null}

      <div className="panel">
            <div className="panel-heading panel-heading--compact">
            <div className="panel-heading-copy">
              <p className="eyebrow">Romanian Paper Money Archive</p>
              <h2>Note Harbor Editor</h2>
            <p>
              {orderedNotes.length} notes in the current view.
              {showSelection && selectedIds.length
                ? ` ${selectedIds.length} selected.`
                : ""}
            </p>
            </div>
            <div className="inline-actions">
              <button
                aria-label="Add banknote"
                className="icon-link button-primary"
                onClick={openCreateNote}
                title="Add banknote"
                type="button"
              >
                Add banknote
              </button>
              <Link
                aria-label="Import or export"
                className="icon-link"
                title="Import / Export"
                to="/import"
              >
                Import / Export
              </Link>
            </div>
          </div>

        {loading ? <p>Loading notes...</p> : null}
        {loadError ? <p className="error-text">{loadError}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {operationStatus.isBusy ? (
          <p className="warning-text">
            Current operation: {String(operationStatus.currentOperation).replace(/_/g, " ")}.
          </p>
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
                      disabled={operationStatus.isBusy}
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
                    disabled={bulkLoading || operationStatus.isBusy || Boolean(scrapeJob)}
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
                    <th>
                      <button
                        className="sort-button"
                        onClick={() => toggleSort("id")}
                        type="button"
                      >
                        ID
                        {sortKey === "id" ? (
                          <span>{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                        ) : null}
                      </button>
                    </th>
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
                  {!orderedNotes.length ? (
                    <tr className="table-empty-row">
                      <td className="table-empty-cell" colSpan={totalColumnCount}>
                        {notes.length
                          ? "No notes match the current view."
                          : "No notes are stored yet. Use Import / Export to import data or add your first banknote."}
                      </td>
                    </tr>
                  ) : null}
                  {virtualRows.map((virtualRow) => {
                    const note = orderedNotes[virtualRow.index];
                    const noteScrapeStatus = displayScrapeStatus(
                      note,
                      scrapeJob,
                    );
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
                                        thumbPreviewState?.noteId === note.id
                                          ? thumbPreviewState.offsetY
                                          : 0
                                      }px`,
                                    }}
                                  >
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
                                    void handleCopyNoteDetails(note);
                                  }}
                                  title="Copy note details"
                                  type="button"
                                  aria-label={`Copy ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="9" y="9" />
                                    <rect fill="none" height="10" rx="2" stroke="currentColor" strokeWidth="2" width="10" x="5" y="5" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openCreateNoteBefore(note.id);
                                  }}
                                  title="Insert note before this"
                                  type="button"
                                  aria-label={`Insert note before ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M12 5v14" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditor(note.id);
                                  }}
                                  title="Edit note"
                                  type="button"
                                  aria-label={`Edit ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M12 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" />
                                  </svg>
                                </button>
                                <button
                                  className="icon-link"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleDeleteNote(note.id);
                                  }}
                                  title="Delete note"
                                  type="button"
                                  aria-label={`Delete ${note.denomination || `note ${note.id}`}`}
                                >
                                  <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
                                    <path d="M5 7h14" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M9 7V5h6v2" fill="none" stroke="currentColor" strokeWidth="2" />
                                    <path d="M8 7l1 12h6l1-12" fill="none" stroke="currentColor" strokeWidth="2" />
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
