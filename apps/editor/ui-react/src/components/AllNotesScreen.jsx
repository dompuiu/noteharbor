import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getAllNotes, getNote } from "../lib/api.js";
import {
  allNotesColumns,
  allNotesDefaultSortKey,
  hideableAllNotesColumns,
  hideableAllNotesColumnKeys,
  lastVisibleAllNotesDataColumnKey,
  loadAllNotesVisibleColumnKeys,
  saveAllNotesVisibleColumnKeys,
} from "../lib/allNotesColumns.js";
import { useCollections } from "../lib/collections.jsx";
import { reportConnectionFailure } from "../lib/connection.js";
import { allNotesListFields } from "../lib/noteFields.js";
import {
  addTagCondition,
  applyNoteView,
  parseConditionsParam,
  serializeConditions,
} from "../lib/noteView.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import { dataColumns, validSortKeys } from "../lib/tableColumns.js";
import { AllNotesTable } from "./AllNotesTable.jsx";
import { Slideshow } from "./Slideshow.jsx";

const slideshowHashPattern =
  /^#slideshow\/(\d+)(?:\/preview\/(front|back))?$/;
const previewKinds = ["front", "back"];
// The slideshow prefetches the open note and its two neighbours; a small
// cache keeps a walk from re-fetching a row the collector steps back to.
const noteDetailCacheLimit = 12;

function noteCountLabel(count) {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

function collectionCountLabel(count) {
  return `${count} ${count === 1 ? "collection" : "collections"}`;
}

function normalizeSortKey(raw) {
  if (raw === allNotesDefaultSortKey) {
    return allNotesDefaultSortKey;
  }

  return validSortKeys.has(raw) ? raw : null;
}

function parseSlideshowHash(hash) {
  const match = String(hash ?? "").match(slideshowHashPattern);

  if (!match) {
    return null;
  }

  return {
    noteId: Number.parseInt(match[1], 10),
    previewKind: match[2] ?? null,
  };
}

export function AllNotesScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    collections,
    collectionsError,
    loadingCollections,
    refreshCollections,
  } = useCollections();
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState(
    loadAllNotesVisibleColumnKeys,
  );
  // The All notes list projects away the scraped details and the note text,
  // so the slideshow reads them from a full note fetched when it opens.
  const [noteDetails, setNoteDetails] = useState(() => new Map());
  const detailRequestsRef = useRef(new Set());
  const detailMountedRef = useRef(true);
  const savedVisibleColumnKeysRef = useRef(visibleColumnKeys);

  const conditionsParam = searchParams.get("fc") ?? "";
  const conditions = useMemo(
    () => parseConditionsParam(conditionsParam),
    [conditionsParam],
  );
  const rawCollection = Number.parseInt(
    searchParams.get("collection") ?? "",
    10,
  );
  const selectedCollection =
    collections.find((collection) => collection.id === rawCollection) ?? null;
  const selectedCollectionId = selectedCollection?.id ?? null;
  const sortKey = normalizeSortKey(searchParams.get("sort"));
  const sortDirection =
    sortKey && searchParams.get("dir") === "desc" ? "desc" : "asc";

  useEffect(() => {
    if (savedVisibleColumnKeysRef.current === visibleColumnKeys) {
      return;
    }

    savedVisibleColumnKeysRef.current = visibleColumnKeys;
    saveAllNotesVisibleColumnKeys(visibleColumnKeys);
  }, [visibleColumnKeys]);

  useEffect(() => {
    let cancelled = false;

    if (loadingCollections || collectionsError) {
      return undefined;
    }

    if (!collections.length) {
      setNotes([]);
      setNotesLoading(false);
      setLoadError("");
      return undefined;
    }

    setNotesLoading(true);
    setLoadError("");
    // A reload replaces every row, so a detail cached from the old list may be
    // stale and its request marker would suppress the new one.
    setNoteDetails(new Map());
    detailRequestsRef.current = new Set();

    getAllNotes(collections, allNotesListFields)
      .then((payload) => {
        if (!cancelled) {
          setNotes(payload.notes ?? []);
        }
      })
      .catch((error) => {
        if (cancelled || reportConnectionFailure(error?.reason)) {
          return;
        }

        setLoadError(error?.message ?? "Request failed.");
      })
      .finally(() => {
        if (!cancelled) {
          setNotesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [collections, collectionsError, loadingCollections, reloadToken]);

  const totalCount = notes.length;
  const collectionCount = collections.length;
  const visibleColumns = useMemo(
    () =>
      allNotesColumns.filter(
        (column) =>
          !column.hideable || visibleColumnKeys.includes(column.key),
      ),
    [visibleColumnKeys],
  );
  // The All-fields chip and Find only search the columns the collector can
  // see, so a hidden column can never keep hiding rows.
  const searchColumns = useMemo(
    () =>
      dataColumns.filter(
        (column) =>
          !column.hideable || visibleColumnKeys.includes(column.key),
      ),
    [visibleColumnKeys],
  );
  // The sort/filter pass over the whole library is the expensive part of a
  // commit, so it runs against deferred inputs: the chip, sort and collection
  // controls paint first, and the new row set lands in a background render.
  const viewInputs = useMemo(
    () => ({
      collectionId: selectedCollectionId,
      collectionSortKey: allNotesDefaultSortKey,
      conditions,
      notes,
      searchColumns,
      sortDirection,
      sortKey,
    }),
    [
      conditions,
      notes,
      searchColumns,
      selectedCollectionId,
      sortDirection,
      sortKey,
    ],
  );
  const deferredView = useDeferredValue(viewInputs);
  const visibleNotes = useMemo(
    () => applyNoteView(deferredView.notes, deferredView),
    [deferredView],
  );
  const deferredConditions = deferredView.conditions;
  const rowsPending = deferredView !== viewInputs;

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

  const countsByCollection = useMemo(() => {
    const counts = new Map();

    notes.forEach((note) => {
      counts.set(note.collection_id, (counts.get(note.collection_id) ?? 0) + 1);
    });

    return counts;
  }, [notes]);

  const collectionOptions = useMemo(
    () => [
      {
        label: `All collections (${totalCount})`,
        value: "",
      },
      ...collections.map((collection) => ({
        label: `${collection.name} (${countsByCollection.get(collection.id) ?? 0})`,
        value: String(collection.id),
      })),
    ],
    [collections, countsByCollection, totalCount],
  );

  const hasActiveFilters =
    Boolean(selectedCollectionId) || conditions.length > 0;
  const shownCount = visibleNotes.length;
  const loading = loadingCollections || notesLoading;
  const displayError = collectionsError || loadError;
  // A library with no notes anywhere is empty even when a stale link carries
  // filters: the empty state must not claim the filters hid things that never
  // existed.
  const emptyLibrary = totalCount === 0;

  const countText = hasActiveFilters
    ? `${shownCount} of ${noteCountLabel(totalCount)}`
    : noteCountLabel(totalCount);
  const scopeText =
    collectionCount === 1
      ? "in 1 collection"
      : `across ${collectionCountLabel(collectionCount)}`;
  const subtitle = loading
    ? "Reading every collection."
    : `${countText} ${scopeText}`;
  const canResetView = hasActiveFilters || sortKey != null;
  const lastVisibleDataColumnKey = lastVisibleAllNotesDataColumnKey(
    visibleColumnKeys,
  );

  const slideshowRoute = parseSlideshowHash(location.hash);
  const slideshowNoteId = slideshowRoute?.noteId ?? null;
  const previewKind = slideshowRoute?.previewKind ?? null;
  const slideshowIndex =
    slideshowNoteId == null
      ? -1
      : visibleNotes.findIndex((note) => note.id === slideshowNoteId);
  const slideshowActive = slideshowNoteId != null;
  // The room only exists once the note resolves in the visible list. The page
  // behind it is inert on the same condition, so a cold link or a list still
  // loading can never leave a dead, inert screen.
  const slideshowOpen = slideshowActive && slideshowIndex >= 0;

  useEffect(() => {
    detailMountedRef.current = true;

    return () => {
      detailMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!slideshowActive || slideshowIndex < 0) {
      return;
    }

    // The slideshow wraps, so the neighbours on both edges are the row at the
    // other end of the filtered list.
    const count = visibleNotes.length;
    const targets = [
      visibleNotes[slideshowIndex],
      visibleNotes[(slideshowIndex + 1) % count],
      visibleNotes[(slideshowIndex - 1 + count) % count],
    ].filter(Boolean);

    targets.forEach((target) => {
      if (
        noteDetails.has(target.id) ||
        detailRequestsRef.current.has(target.id)
      ) {
        return;
      }

      detailRequestsRef.current.add(target.id);

      getNote(target.id, target.collection_id)
        .then((payload) => {
          detailRequestsRef.current.delete(target.id);

          if (!detailMountedRef.current || !payload?.note) {
            return;
          }

          setNoteDetails((current) => {
            const next = new Map(current).set(target.id, payload.note);

            // Bound the cache: only the open note and its neighbours are
            // needed, so a long slideshow walk cannot hold the whole library.
            while (next.size > noteDetailCacheLimit) {
              next.delete(next.keys().next().value);
            }

            return next;
          });
        })
        .catch(() => {
          // The projected note still paints; a later open retries.
          detailRequestsRef.current.delete(target.id);
        });
    });
  }, [noteDetails, slideshowActive, slideshowIndex, visibleNotes]);

  const slideshowNotes = useMemo(() => {
    if (!noteDetails.size) {
      return visibleNotes;
    }

    return visibleNotes.map((note) => {
      const detail = noteDetails.get(note.id);

      return detail ? { ...note, ...detail } : note;
    });
  }, [noteDetails, visibleNotes]);

  function allNotesUrl(hash = "") {
    return {
      pathname: location.pathname,
      search: location.search,
      hash,
    };
  }

  useEffect(() => {
    // The deferred view can still be one render behind the hash: wait for it
    // to land before deciding a deep link names no row.
    if (!slideshowActive || loading || rowsPending) {
      return;
    }

    if (slideshowIndex < 0) {
      navigate(allNotesUrl(), { replace: true });
    }
  }, [
    loading,
    navigate,
    rowsPending,
    slideshowActive,
    slideshowIndex,
    location.search,
  ]);

  function updateParam(name, value) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);

        if (value == null || value === "") {
          next.delete(name);
        } else {
          next.set(name, String(value));
        }

        return next;
      },
      { replace: true },
    );
  }

  function handleConditionsChange(updater) {
    setSearchParams(
      (current) => {
        const currentConditions = parseConditionsParam(current.get("fc") ?? "");
        const nextConditions =
          typeof updater === "function" ? updater(currentConditions) : updater;
        const next = new URLSearchParams(current);

        if (nextConditions.length) {
          next.set("fc", serializeConditions(nextConditions));
        } else {
          next.delete("fc");
        }

        return next;
      },
      { replace: true },
    );
  }

  function handleSort(key) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        const currentKey = normalizeSortKey(current.get("sort"));
        const currentDirection =
          current.get("dir") === "desc" ? "desc" : "asc";

        if (!currentKey || currentKey !== key) {
          next.set("sort", key);
          next.set("dir", "asc");
        } else if (currentDirection === "asc") {
          next.set("dir", "desc");
        } else {
          next.delete("sort");
          next.delete("dir");
        }

        return next;
      },
      { replace: true },
    );
  }

  function handleClearFilters() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("collection");
        next.delete("fc");
        return next;
      },
      { replace: true },
    );
  }

  function handleResetView() {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("collection");
        next.delete("fc");
        next.delete("sort");
        next.delete("dir");
        return next;
      },
      { replace: true },
    );
  }

  function handleCollectionChange(value) {
    updateParam("collection", value);
  }

  function handleApplyTagFilter(tagName, { replace = false } = {}) {
    handleConditionsChange((current) =>
      addTagCondition(current, tagName, { replace }),
    );
  }

  function handleToggleColumn(key) {
    const column = allNotesColumns.find((entry) => entry.key === key);

    if (!column?.hideable) {
      return;
    }

    if (!visibleColumnKeys.includes(key)) {
      const restoredColumns = hideableAllNotesColumnKeys.filter(
        (currentKey) =>
          currentKey === key || visibleColumnKeys.includes(currentKey),
      );

      setVisibleColumnKeys(restoredColumns);
      return;
    }

    const remaining = visibleColumnKeys.filter(
      (currentKey) => currentKey !== key,
    );

    if (!remaining.length) {
      return;
    }

    // A hidden column must not keep hiding rows: drop its chips with it.
    if (conditions.some((condition) => condition.field === key)) {
      handleConditionsChange((current) =>
        current.filter((condition) => condition.field !== key),
      );
    }

    // The sorted column is about to disappear: fall back to the screen's
    // default collection order so the active sort always names a header.
    if (sortKey === key) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("sort");
          next.delete("dir");
          return next;
        },
        { replace: true },
      );
    }

    setVisibleColumnKeys(remaining);
  }

  function handleOpenNote(note) {
    navigate(allNotesUrl(`#slideshow/${note.id}`));
  }

  function handleCloseSlideshow() {
    navigate(allNotesUrl(), { replace: true });
  }

  function handleChangeSlideshowIndex(updater) {
    if (!visibleNotes.length || slideshowIndex < 0) {
      return;
    }

    const resolvedIndex =
      typeof updater === "function" ? updater(slideshowIndex) : updater;
    const boundedIndex =
      ((resolvedIndex % visibleNotes.length) + visibleNotes.length) %
      visibleNotes.length;
    const nextNote = visibleNotes[boundedIndex];

    if (nextNote) {
      navigate(allNotesUrl(`#slideshow/${nextNote.id}`));
    }
  }

  function handleOpenPreview(noteId, kind) {
    navigate(allNotesUrl(`#slideshow/${noteId}/preview/${kind}`));
  }

  function handleClosePreview(noteId) {
    navigate(allNotesUrl(`#slideshow/${noteId}`), { replace: true });
  }

  function movePreview(offset) {
    if (!slideshowActive || !visibleNotes.length || !previewKind) {
      return;
    }

    const direction = offset >= 0 ? 1 : -1;
    let nextNoteIndex = slideshowIndex;

    if (nextNoteIndex < 0) {
      return;
    }

    let nextItemIndex = previewKinds.indexOf(previewKind);

    if (nextItemIndex < 0) {
      nextItemIndex = direction > 0 ? -1 : previewKinds.length;
    }

    let remainingSteps = Math.abs(offset);

    while (remainingSteps > 0) {
      const candidateIndex = nextItemIndex + direction;

      if (candidateIndex >= 0 && candidateIndex < previewKinds.length) {
        nextItemIndex = candidateIndex;
        remainingSteps -= 1;
        continue;
      }

      nextNoteIndex =
        (nextNoteIndex + direction + visibleNotes.length) %
        visibleNotes.length;
      nextItemIndex = direction > 0 ? 0 : previewKinds.length - 1;
      remainingSteps -= 1;
    }

    navigate(
      allNotesUrl(
        `#slideshow/${visibleNotes[nextNoteIndex].id}/preview/${previewKinds[nextItemIndex]}`,
      ),
    );
  }

  function jumpToPreview(position) {
    if (!slideshowActive || !visibleNotes.length || !previewKind) {
      return;
    }

    const perNote = previewKinds.length;
    const target = Math.min(
      Math.max(position, 1),
      visibleNotes.length * perNote,
    );
    const nextNoteIndex = Math.floor((target - 1) / perNote);
    const nextItemIndex = (target - 1) % perNote;
    const nextNote = visibleNotes[nextNoteIndex];

    if (nextNote) {
      navigate(
        allNotesUrl(
          `#slideshow/${nextNote.id}/preview/${previewKinds[nextItemIndex]}`,
        ),
      );
    }
  }

  function jumpPreview(edge) {
    if (!slideshowActive || !visibleNotes.length || !previewKind) {
      return false;
    }

    const atStart = edge === "start";
    const nextNoteIndex = atStart ? 0 : visibleNotes.length - 1;
    const nextKind = atStart ? previewKinds[0] : previewKinds[previewKinds.length - 1];
    const nextNote = visibleNotes[nextNoteIndex];

    if (
      nextNote.id === slideshowNoteId &&
      nextKind === previewKind
    ) {
      return false;
    }

    navigate(allNotesUrl(`#slideshow/${nextNote.id}/preview/${nextKind}`));

    return true;
  }

  async function handleRetry() {
    if (collectionsError) {
      await refreshCollections();
      return;
    }

    setReloadToken((current) => current + 1);
  }

  function renderEmptyContent() {
    if (emptyLibrary) {
      return (
        <div className="table-empty-state">
          <p className="table-empty-title">No notes yet</p>
          <p className="table-empty-hint">
            Notes live inside collections. Import a collection or add a note to
            get started.
          </p>
          <div className="table-empty-actions">
            <Link className="button" to={CATALOG_ROUTES.collections}>
              Go to collections
            </Link>
            <Link className="button" to={CATALOG_ROUTES.importExport}>
              Import / Export
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="table-empty-state">
        <p className="table-empty-title">No notes match these filters.</p>
        <p className="table-empty-hint">
          {selectedCollection
            ? `No notes in ${selectedCollection.name} match every filter in this view.`
            : "No note matches every filter in this view."}
        </p>
        <button className="button" onClick={handleClearFilters} type="button">
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <section className="screen-stack all-notes-screen">
      <div className="screen-body" inert={slideshowOpen}>
        <div className="panel-heading panel-heading--compact">
          <div className="panel-heading-copy">
            <p className="eyebrow collection-eyebrow">Catalog</p>
            <h1>All notes</h1>
            {displayError ? null : (
              <p className="muted all-notes-subtitle">{subtitle}</p>
            )}
          </div>
        </div>

        {displayError ? (
          <div className="table-shell table-load-error">
            <div className="table-load-error-body">
              <div className="table-load-error-copy" role="alert">
                <h2 className="table-load-error-title">
                  Couldn't load notes.
                </h2>
                <p className="table-load-error-detail">{displayError}</p>
              </div>
              <p className="table-load-error-note">
                Your notes stay on this device and aren't affected.
              </p>
              <button
                className="button button-primary"
                onClick={handleRetry}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="table-shell table-loading">
            <div className="table-loading-body" role="status">
              <p className="table-loading-title">Loading notes…</p>
              <p className="table-loading-detail">
                Reading every collection on this device.
              </p>
            </div>
          </div>
        ) : (
          <AllNotesTable
            allNotes={notes}
            canResetView={canResetView}
            collectionCount={collectionCount}
            collectionOptions={collectionOptions}
            columns={visibleColumns}
            conditions={conditions}
            paintedConditions={deferredConditions}
            emptyContent={renderEmptyContent()}
            hasActiveFilters={hasActiveFilters}
            hideableColumns={hideableAllNotesColumns}
            notes={visibleNotes}
            rowsPending={rowsPending}
            onApplyTagFilter={handleApplyTagFilter}
            onClearFilters={handleClearFilters}
            onCollectionChange={handleCollectionChange}
            onConditionsChange={handleConditionsChange}
            onOpenNote={handleOpenNote}
            onResetView={handleResetView}
            onSearchAll={handleClearFilters}
            onSort={handleSort}
            onToggleColumn={handleToggleColumn}
            searchColumns={searchColumns}
            selectedCollectionId={selectedCollectionId}
            showToolbar={!emptyLibrary}
            slideshowActive={slideshowActive}
            sortDirection={sortDirection}
            sortKey={sortKey}
            tagNames={tagNames}
            totalCount={totalCount}
            visibleColumnKeys={visibleColumnKeys}
            lastVisibleDataColumnKey={lastVisibleDataColumnKey}
          />
        )}
      </div>

      {slideshowOpen ? (
        <Slideshow
          currentIndex={slideshowIndex}
          notes={slideshowNotes}
          onChangeIndex={handleChangeSlideshowIndex}
          onClose={handleCloseSlideshow}
          onClosePreview={handleClosePreview}
          onJump={(position) => handleChangeSlideshowIndex(position - 1)}
          onJumpPreview={jumpToPreview}
          onMovePreview={movePreview}
          onOpenPreview={handleOpenPreview}
          onPreviewEnd={() => jumpPreview("end")}
          onPreviewStart={() => jumpPreview("start")}
          previewKind={previewKind}
          readOnly
        />
      ) : null}
    </section>
  );
}
