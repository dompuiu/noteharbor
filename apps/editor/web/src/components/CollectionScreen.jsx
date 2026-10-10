import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { CATALOG_ROUTES, DEFAULT_DESTINATION, NEW_COLLECTION_ID } from "../lib/routes.js";
import { useCollections } from "../lib/collections.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { NotesTable } from "./NotesTable.jsx";

// One collection, rendered in one of two near-identical modes. View mode shows
// the collection's notes table; edit mode is a draft with Save/Cancel.
// Both share the same header shell so the two never drift — the showcases
// pattern applied to collections.
function CollectionScreen({ mode }) {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    collections,
    loadingCollections,
    collectionsError,
    createCollection,
    renameCollection,
    setDefaultCollection,
    deleteCollection,
    pendingCollection,
    beginPendingCollection,
    discardPendingCollection,
  } = useCollections();
  // `new` is the not-yet-saved draft from `+ New collection`: no server row;
  // Save POSTs it, Cancel discards it.
  const isNew = id === NEW_COLLECTION_ID;
  const collectionId = isNew ? null : Number(id);
  const collection = isNew
    ? null
    : (collections.find((entry) => entry.id === collectionId) ?? null);
  const collectionName = isNew
    ? (pendingCollection?.name ?? "Collection")
    : (collection?.name ?? "Collection");
  const editMode = mode === "edit";
  // Arriving from `+ New collection` opens the name field focused (and
  // selected) so the user can name the collection immediately.
  const justCreated = editMode && Boolean(location.state?.justCreated);
  const nameFieldRef = useRef(null);
  const [nameDraft, setNameDraft] = useState(collectionName);
  const [nameError, setNameError] = useState("");
  const [defaultDraft, setDefaultDraft] = useState(false);
  const [defaultInitialized, setDefaultInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();

  useEffect(() => {
    if (!justCreated) {
      return;
    }

    const field = nameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [justCreated]);

  // The heading and the sidebar both read the provider's row, so a rename is
  // reflected everywhere from one applied server row. Keep the local draft in
  // step with it, but never clobber text the user is typing.
  useEffect(() => {
    if (document.activeElement === nameFieldRef.current) {
      return;
    }

    setNameDraft(collectionName);
  }, [collectionName]);

  // Initialise the default toggle from the server row once it arrives. The
  // draft flag guards user toggles from being overwritten by late loads.
  useEffect(() => {
    if (isNew || defaultInitialized) {
      return;
    }

    if (collection) {
      setDefaultDraft(Number(collection.is_default) === 1);
      setDefaultInitialized(true);
    }
  }, [collection, defaultInitialized, isNew]);

  useEffect(() => {
    setDefaultInitialized(false);
  }, [collectionId, isNew]);

  // A direct load of the draft URL (reload, share) has no provider draft yet;
  // stage one so the sidebar row and the canvas agree.
  useEffect(() => {
    if (isNew && !pendingCollection) {
      beginPendingCollection();
    }
  }, [isNew, pendingCollection, beginPendingCollection]);

  // Viewing a collection shows that collection's notes table: the route's
  // `:id` is the source of truth, so there is no active-collection switch.

  // In edit mode the name field is part of the draft: blur/Enter only validate
  // locally, and Save persists the rename together with the default flag.
  function commitName() {
    if (!collection && !isNew) {
      return;
    }

    const trimmed = nameDraft.trim();

    if (!trimmed) {
      setNameError("A collection name is required.");
      return;
    }

    const currentName = isNew
      ? (pendingCollection?.name ?? "Collection")
      : collection.name;

    if (trimmed === currentName) {
      setNameDraft(currentName);
      setNameError("");
      return;
    }

    setNameDraft(trimmed);
    setNameError("");
  }

  function handleNameKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitName();
      event.currentTarget?.blur?.();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // A new collection starts with the name field focused: Escape bails out
      // of the whole draft, exactly like Cancel, instead of only reverting
      // the field.
      if (isNew) {
        handleCancel();
        return;
      }
      setNameDraft(collection?.name ?? "Collection");
      setNameError("");
    }
  }

  const nameDirty =
    editMode && !isNew && collection
      ? nameDraft.trim() !== "" && nameDraft.trim() !== collection.name
      : false;
  const defaultDirty =
    editMode && !isNew && collection
      ? defaultDraft !== (Number(collection.is_default) === 1)
      : false;
  // A draft collection is itself unsaved, so Save stays enabled whenever the
  // name is non-empty — even with nothing else changed.
  const dirty = editMode && (isNew ? nameDraft.trim() !== "" : nameDirty || defaultDirty);

  async function handleSave() {
    if (!editMode || saving || loadingCollections || confirmOpen) {
      return;
    }

    const trimmedName = nameDraft.trim();

    if (!trimmedName) {
      setNameError("A collection name is required.");
      return;
    }

    setSaving(true);
    setSaveError("");
    setNameError("");

    try {
      if (isNew) {
        // Deferred creation: the POST happens here, not on `+ New collection`.
        // An untouched "Collection" name omits the name so the server picks a
        // unique default instead of hitting the duplicate-name error.
        const created = await createCollection(
          trimmedName.toLowerCase() === "collection" ? undefined : trimmedName,
        );

        if (created?.id == null) {
          throw new Error("Could not save the collection.");
        }

        if (defaultDraft) {
          await setDefaultCollection(created.id);
        }

        // createCollection clears the pending draft; land on the real view.
        navigate(CATALOG_ROUTES.collection(created.id));
        return;
      }

      if (collection && trimmedName !== collection.name) {
        await renameCollection(collection.id, trimmedName);
      }

      if (collection && defaultDirty) {
        await setDefaultCollection(collection.id);
      }

      navigate(CATALOG_ROUTES.collection(collectionId));
    } catch (error) {
      setSaveError(error.message || "Could not save the collection.");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (saving) {
      return;
    }

    // A draft collection has no view to return to: discard it and land on the
    // last collection in the list (or home when the list is empty) so the
    // sidebar row disappears with it.
    if (isNew) {
      discardPendingCollection();
      const lastCollection = collections[collections.length - 1] ?? null;
      navigate(
        lastCollection
          ? CATALOG_ROUTES.collection(lastCollection.id)
          : DEFAULT_DESTINATION,
      );
      return;
    }

    navigate(CATALOG_ROUTES.collection(collectionId));
  }

  async function handleDelete() {
    if (!collection || deleting) {
      return;
    }

    const confirmed = await confirm({
      body: "This removes the collection and all of its notes. This cannot be undone.",
      confirmLabel: "Delete",
      title: `Delete "${collection.name}"?`,
    });

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const { nextCollectionId } = await deleteCollection(collection.id);

      if (nextCollectionId != null) {
        navigate(CATALOG_ROUTES.collectionEdit(nextCollectionId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  const noteCount = collection ? Number(collection.note_count ?? 0) : 0;  const isDefault = isNew ? defaultDraft : (collection ? Number(collection.is_default) === 1 : defaultDraft);
  const invalidId = !isNew && (!Number.isInteger(collectionId) || collectionId <= 0);
  const missingCollection = !isNew && !invalidId && !loadingCollections && !collectionsError && !collection;

  // The collection view is the notes table for that collection, so
  // `/catalog/collections/:id/view` reads the notes directly. The Edit action
  // lives in the table header next to Add note; the table already shows the
  // loading and error states.
  if (!editMode && !isNew) {
    if (invalidId || missingCollection) {
      return (
        <section className="screen-stack showcase-screen collection-screen collection-screen--view">
          <div className="panel">
            <div className="showcase-empty-box">
              <p className="showcase-empty-title">Collection not found.</p>
              <p className="showcase-empty-text muted">
                This collection no longer exists.
              </p>
              <div className="showcase-empty-actions">
                <Link className="button" to={DEFAULT_DESTINATION}>
                  View collections
                </Link>
              </div>
            </div>
          </div>
        </section>
      );
    }

    return (
      <section className="screen-stack showcase-screen collection-screen collection-screen--view">
        <NotesTable
          collection={collection}
          collectionId={collectionId}
          collections={collections}
          collectionsError={collectionsError}
          editCollectionTo={CATALOG_ROUTES.collectionEdit(collectionId)}
          loadingCollections={loadingCollections}
        />
      </section>
    );
  }

  return (
    <section
      className={`screen-stack showcase-screen collection-screen collection-screen--${editMode ? "edit" : "view"}`}
    >
      <div className="panel">
        <div className="panel-heading">
          {editMode || isNew ? (
            <div className="panel-heading-copy">
              <p className="eyebrow">Catalog</p>
              {editMode ? (
                <input
                  aria-label="Collection name"
                  className="showcase-name-field"
                  onBlur={commitName}
                  onChange={(event) => {
                    setNameDraft(event.target.value);
                    setNameError("");
                    setSaveError("");
                  }}
                  onKeyDown={handleNameKeyDown}
                  ref={nameFieldRef}
                  value={nameDraft}
                />
              ) : (
                <h1>{collectionName}</h1>
              )}
              {!isNew && collection ? (
                <p className="muted">{`${noteCount} notes${isDefault ? " · Default" : ""}`}</p>
              ) : null}
              {isNew ? (
                <p className="muted">New collection — unsaved until you press Save.</p>
              ) : null}
              {editMode && dirty && !loadingCollections ? (
                <p className="muted">Unsaved changes</p>
              ) : null}
            </div>
          ) : null}
          <div className="panel-heading-actions">
            {/* Edit mode is a draft: Save persists the name and the default
            flag, Cancel discards both and returns to view. */}
            {editMode ? (
              <>
                {collection ? (
                  <button
                    className="button button-danger"
                    disabled={deleting}
                    onClick={handleDelete}
                    type="button"
                  >
                    Delete collection
                  </button>
                ) : null}
                <button
                  className="button"
                  disabled={saving}
                  onClick={handleCancel}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  disabled={!dirty || saving || loadingCollections}
                  onClick={handleSave}
                  type="button"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                {collection || isNew ? (
                  <Link
                    className="button"
                    to={CATALOG_ROUTES.collectionEdit(isNew ? NEW_COLLECTION_ID : collectionId)}
                  >
                    Edit
                  </Link>
                ) : null}
              </>
            )}
          </div>
        </div>

        {dialog}

        {nameError ? (
          <p className="muted showcase-name-error" role="alert">
            {nameError}
          </p>
        ) : null}

        {saveError ? (
          <p className="showcase-error" role="alert">
            {saveError}
          </p>
        ) : null}

        {loadingCollections ? (
          <p className="muted showcase-empty">Loading collection…</p>
        ) : null}

        {!loadingCollections && collectionsError ? (
          <p className="showcase-error" role="alert">
            {collectionsError}
          </p>
        ) : null}

        {invalidId || missingCollection ? (
          <div className="showcase-empty-box">
            <p className="showcase-empty-title">Collection not found.</p>
            <p className="showcase-empty-text muted">
              This collection no longer exists.
            </p>
            <div className="showcase-empty-actions">
              <Link className="button" to={DEFAULT_DESTINATION}>
                View collections
              </Link>
            </div>
          </div>
        ) : null}

        {editMode ? (
          <label className="muted">
            <input
              checked={defaultDraft}
              disabled={saving || loadingCollections}
              onChange={(event) => {
                setDefaultDraft(event.target.checked);
                setSaveError("");
              }}
              type="checkbox"
            />
            {" Default collection (new notes land here)"}
          </label>
        ) : null}
      </div>

    </section>
  );
}

export { CollectionScreen };
