import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { collectionDeleteConfirmation } from "../lib/collectionActions.js";
import { CATALOG_ROUTES, DEFAULT_DESTINATION, NEW_COLLECTION_ID } from "../lib/routes.js";
import { useCollections } from "../lib/collections.jsx";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { NotesTable } from "./NotesTable.jsx";
import { TablePerfBoundary } from "./TablePerfBoundary.jsx";
import { useToastHost } from "./Toast.jsx";

// The table is the expensive part of this screen, so the opt-in dev readout
// wraps it here rather than inside NotesTable. With the flag off the boundary
// hands the table through untouched.
function TableWithPerfReadout(props) {
  return (
    <TablePerfBoundary>
      <NotesTable {...props} />
    </TablePerfBoundary>
  );
}

// One collection, rendered in one of two modes sharing one container.
// View mode shows the title with rename; Add note rides in the table rail.
// Edit mode swaps the title for a text field and Delete / Cancel / Save.
// The notes table stays visible in both.
function CollectionScreen({ mode }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    collections,
    loadingCollections,
    collectionsError,
    createCollection,
    renameCollection,
    deleteCollection,
    pendingCollection,
    beginPendingCollection,
    updatePendingCollectionName,
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
  const nameFieldRef = useRef(null);
  const [nameDraft, setNameDraft] = useState(collectionName);
  const [nameError, setNameError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();
  const toastHost = useToastHost();

  // Entering edit mode lands the cursor in the title field (focused and
  // selected) so the name can be retyped at once. The `e` shortcut from
  // view relies on this; Esc in the field leaves edit mode again. A
  // not-yet-saved collection renders its own field, so a missing ref is
  // simply a no-op here.
  useEffect(() => {
    if (!editMode) {
      return;
    }

    const field = nameFieldRef.current;

    if (field) {
      field.focus();
      field.select?.();
    }
  }, [editMode, isNew, collectionId]);

  // The heading and the sidebar both read the provider's row, so a rename is
  // reflected everywhere from one applied server row. Keep the local draft in
  // step with it, but never clobber text the user is typing.
  useEffect(() => {
    if (document.activeElement === nameFieldRef.current) {
      return;
    }

    setNameDraft(collectionName);
  }, [collectionName]);

  // A direct load of the draft URL (reload, share) has no provider draft yet;
  // stage one so the sidebar row and the canvas agree.
  useEffect(() => {
    if (isNew && !pendingCollection) {
      beginPendingCollection();
    }
  }, [isNew, pendingCollection, beginPendingCollection]);

  // In edit mode the name field is part of the draft: blur/Enter only validate
  // locally, and Save persists the rename.
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

    if (isNew) {
      // The rail shows the name that will be saved: drop the surrounding
      // whitespace the field still holds.
      updatePendingCollectionName(trimmed);
    }
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
      // Escape leaves edit mode entirely, exactly like Cancel: the draft is
      // discarded and the view returns.
      handleCancel();
    }
  }

  const nameDirty =
    editMode && !isNew && collection
      ? nameDraft.trim() !== "" && nameDraft.trim() !== collection.name
      : false;
  // A draft collection is itself unsaved, so Save stays enabled whenever the
  // name is non-empty — even with nothing else changed.
  const dirty = editMode && (isNew ? nameDraft.trim() !== "" : nameDirty);

  async function handleSave() {
    if ((!editMode && !isNew) || saving || loadingCollections || confirmOpen) {
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

        // createCollection clears the pending draft; land on the real view.
        navigate(CATALOG_ROUTES.collection(created.id));
        return;
      }

      if (collection && trimmedName !== collection.name) {
        await renameCollection(collection.id, trimmedName);
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
      if (discardPendingCollection()) {
        toastHost?.current?.show("Collection draft discarded.", "info");
      }
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

  // View mode edits the collection in place: the table's header owns the
  // rename field and its menu owns the delete confirmation, so these just
  // apply the change and let a failure surface back in that header.
  async function handleInlineRename(name) {
    if (!collection) {
      throw new Error("That collection no longer exists.");
    }

    await renameCollection(collection.id, name);
  }

  async function handleInlineDelete() {
    if (!collection) {
      throw new Error("That collection no longer exists.");
    }

    const { nextCollectionId } = await deleteCollection(collection.id);

    navigate(
      nextCollectionId != null
        ? CATALOG_ROUTES.collection(nextCollectionId)
        : DEFAULT_DESTINATION,
    );
  }

  async function handleDelete() {
    if (!collection || deleting) {
      return;
    }

    const confirmed = await confirm(
      collectionDeleteConfirmation(collection.name),
    );

    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      const { nextCollectionId } = await deleteCollection(collection.id);

      if (nextCollectionId != null) {
        navigate(CATALOG_ROUTES.collection(nextCollectionId));
      } else {
        navigate(DEFAULT_DESTINATION);
      }
    } catch (error) {
      setNameError(error.message);
      setDeleting(false);
    }
  }

  const invalidId = !isNew && (!Number.isInteger(collectionId) || collectionId <= 0);
  const missingCollection = !isNew && !invalidId && !loadingCollections && !collectionsError && !collection;

  // A not-yet-saved collection renders the same notes-table view as a saved
  // one: the title is the draft text field (focused, with save/cancel icons)
  // above an empty table. Save POSTs the draft; Cancel discards it.
  if (isNew) {
    return (
      <section className="screen-stack showcase-screen collection-screen collection-screen--edit">
        <TableWithPerfReadout
          collection={null}
          collectionId={null}
          collections={collections}
          collectionsError={collectionsError}
          loadingCollections={loadingCollections}
          isNewCollection
          newCollectionName={nameDraft}
          onNewCollectionNameChange={(value) => {
            setNameDraft(value);
            updatePendingCollectionName(value);
            setNameError("");
            setSaveError("");
          }}
          onSaveNewCollection={handleSave}
          onCancelNewCollection={handleCancel}
          savingNewCollection={saving}
          newCollectionError={nameError || saveError}
        />
      </section>
    );
  }

  // The collection view is the notes table for that collection, so
  // `/catalog/collections/:id/view` reads the notes directly. The table owns
  // the inline collection rename next to its title; the table already shows
  // the loading and error states.
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
        <TableWithPerfReadout
          collection={collection}
          collectionId={collectionId}
          collections={collections}
          collectionsError={collectionsError}
          loadingCollections={loadingCollections}
          onDeleteCollection={handleInlineDelete}
          onRenameCollection={handleInlineRename}
        />
      </section>
    );
  }

  // Edit mode is the normal table container with the title as a text
  // field and Delete / Cancel / Save replacing the view's title controls.
  // There is no second panel: one container, same table below.
  if (invalidId || missingCollection) {
    return (
      <section className="screen-stack showcase-screen collection-screen collection-screen--edit">
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
    <section className="screen-stack showcase-screen collection-screen collection-screen--edit">
      <TableWithPerfReadout
        collection={collection}
        collectionId={collectionId}
        collections={collections}
        collectionsError={collectionsError}
        loadingCollections={loadingCollections}
        isCollectionEditing
        collectionEditName={nameDraft}
        onCollectionEditNameChange={(value) => {
          setNameDraft(value);
          setNameError("");
          setSaveError("");
        }}
        onCollectionEditNameBlur={commitName}
        onCollectionEditNameKeyDown={handleNameKeyDown}
        collectionEditFieldRef={nameFieldRef}
        collectionEditError={nameError || saveError}
        onSaveCollectionEdit={handleSave}
        onCancelCollectionEdit={handleCancel}
        onDeleteCollectionEdit={handleDelete}
        savingCollectionEdit={saving}
        deletingCollectionEdit={deleting}
        canSaveCollectionEdit={dirty}
        collectionEditDialog={dialog}
      />
    </section>
  );
}

export { CollectionScreen };
