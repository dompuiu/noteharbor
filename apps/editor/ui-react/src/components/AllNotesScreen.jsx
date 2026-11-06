import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getAllNotes } from "../lib/api.js";
import { useCollections } from "../lib/collections.jsx";
import { reportConnectionFailure } from "../lib/connection.js";
import {
  addTagCondition,
  filterNotesByConditions,
  parseConditionsParam,
  serializeConditions,
  sortNotesByCollection,
  sortNotesBySort,
} from "../lib/noteView.js";
import { CATALOG_ROUTES } from "../lib/routes.js";
import { dataColumns, validSortKeys } from "../lib/tableColumns.js";
import { AllNotesTable } from "./AllNotesTable.jsx";

const collectionSortKey = "collection";

function noteCountLabel(count) {
  return `${count} ${count === 1 ? "note" : "notes"}`;
}

function collectionCountLabel(count) {
  return `${count} ${count === 1 ? "collection" : "collections"}`;
}

function normalizeSortKey(raw) {
  if (raw === collectionSortKey) {
    return collectionSortKey;
  }

  return validSortKeys.has(raw) ? raw : null;
}

export function AllNotesScreen() {
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

    getAllNotes(collections)
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
  const visibleNotes = useMemo(() => {
    const collectionNotes = selectedCollectionId
      ? notes.filter((note) => note.collection_id === selectedCollectionId)
      : notes;
    const filtered = filterNotesByConditions(
      collectionNotes,
      conditions,
      dataColumns,
    );

    if (!sortKey || sortKey === collectionSortKey) {
      return sortNotesByCollection(filtered, sortDirection);
    }

    return sortNotesBySort(filtered, sortKey, sortDirection);
  }, [conditions, notes, selectedCollectionId, sortDirection, sortKey]);

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
  const summary = `Showing ${shownCount} of ${noteCountLabel(totalCount)} across ${collectionCountLabel(collectionCount)}`;

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

  function handleCollectionChange(value) {
    updateParam("collection", value);
  }

  function handleApplyTagFilter(tagName, { replace = false } = {}) {
    handleConditionsChange((current) =>
      addTagCondition(current, tagName, { replace }),
    );
  }

  function handleOpenNote(note) {
    navigate(CATALOG_ROUTES.noteSlideshow(note.collection_id, note.id));
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
      <div className="screen-body">
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
            collectionOptions={collectionOptions}
            conditions={conditions}
            emptyContent={renderEmptyContent()}
            hasActiveFilters={hasActiveFilters}
            notes={visibleNotes}
            onApplyTagFilter={handleApplyTagFilter}
            onClearFilters={handleClearFilters}
            onCollectionChange={handleCollectionChange}
            onConditionsChange={handleConditionsChange}
            onOpenNote={handleOpenNote}
            onSort={handleSort}
            searchColumns={dataColumns}
            selectedCollectionId={selectedCollectionId}
            showToolbar={!emptyLibrary}
            sortDirection={sortDirection}
            sortKey={sortKey}
            summary={summary}
            tagNames={tagNames}
          />
        )}
      </div>
    </section>
  );
}
