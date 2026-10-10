import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
  reorderCollections,
} from './api.js';

const CollectionsContext = createContext(null);

function CollectionsProvider({ children }) {
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [collectionsError, setCollectionsError] = useState('');
  // Why the last load failed, in the shell's connection vocabulary ('server',
  // 'database', 'generic'). The shell reads its connection state from this load
  // instead of running a separate health probe before the first paint.
  const [collectionsErrorReason, setCollectionsErrorReason] = useState(null);
  // A not-yet-saved collection started from `+ New collection`. It renders as
  // a draft row in the sidebar and an empty edit canvas; Save POSTs it, while
  // Cancel or leaving the `new` route discards it without a request.
  const [pendingCollection, setPendingCollection] = useState(null);

  async function refreshCollections() {
    setLoadingCollections(true);
    setCollectionsError('');
    setCollectionsErrorReason(null);

    try {
      const payload = await getCollections();
      const nextCollections = payload.collections ?? [];
      setCollections(nextCollections);
    } catch (error) {
      setCollectionsError(error.message);
      setCollectionsErrorReason(error.reason ?? 'generic');
    } finally {
      setLoadingCollections(false);
    }
  }

  useEffect(() => {
    refreshCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile the list from a single server row after a mutation, rather than
  // refetching every collection. A full refresh flips `loadingCollections`
  // (blanking the table) and can drop the caller's just-landed focus — neither
  // of which a one-row change should do.
  function applyCollectionRow(updatedCollection) {
    if (!updatedCollection) {
      return;
    }

    setCollections((current) => {
      const exists = current.some(
        (collection) => collection.id === updatedCollection.id,
      );

      if (!exists) {
        return [...current, updatedCollection];
      }

      return current.map((collection) =>
        collection.id === updatedCollection.id
          ? { ...collection, ...updatedCollection }
          : collection,
      );
    });
  }

  async function handleCreateCollection(name) {
    const payload = await createCollection(name);
    const createdCollection = payload.collection;

    if (createdCollection) {
      applyCollectionRow(createdCollection);
      // A pending draft (if any) is now real; drop it so the sidebar shows
      // only the server row.
      setPendingCollection(null);
    }

    return createdCollection;
  }

  function beginPendingCollection() {
    setPendingCollection((current) => current ?? { id: 'new', name: 'Collection' });
  }

  function discardPendingCollection() {
    setPendingCollection(null);
  }

  async function handleRenameCollection(collectionId, name) {
    const payload = await renameCollection(collectionId, name);
    applyCollectionRow(payload.collection);
    return payload.collection;
  }

  async function handleReorderCollections(ids) {
    const payload = await reorderCollections(ids);
    const nextCollections = payload.collections ?? [];
    // Apply the server's order directly instead of round-tripping through
    // refreshCollections: a reorder is not a load, and flipping the loading
    // flag would blank the table mid-drag.
    setCollections(nextCollections);
    return nextCollections;
  }

  async function handleDeleteCollection(collectionId) {
    const index = collections.findIndex((collection) => collection.id === collectionId);
    const nextCollection =
      collections[index + 1] ??
      collections[index - 1] ??
      collections.find((collection) => collection.id !== collectionId) ??
      null;

    await deleteCollection(collectionId);

    const remaining = collections.filter(
      (collection) => collection.id !== collectionId,
    );
    setCollections(remaining);

    return { nextCollectionId: nextCollection?.id ?? null };
  }

  const value = useMemo(
    () => ({
      collections,
      collectionsError,
      collectionsErrorReason,
      createCollection: handleCreateCollection,
      deleteCollection: handleDeleteCollection,
      loadingCollections,
      pendingCollection,
      beginPendingCollection,
      discardPendingCollection,
      refreshCollections,
      renameCollection: handleRenameCollection,
      reorderCollections: handleReorderCollections,
    }),
    [
      collections,
      collectionsError,
      collectionsErrorReason,
      loadingCollections,
      pendingCollection,
    ],
  );

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

function useCollections() {
  const context = useContext(CollectionsContext);

  if (!context) {
    throw new Error('useCollections must be used inside CollectionsProvider.');
  }

  return context;
}

export { CollectionsProvider, useCollections };
