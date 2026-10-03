import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
  reorderCollections,
  setDefaultCollection,
} from './api.js';

const activeCollectionStorageKey = 'noteharbor.activeCollectionId';

const CollectionsContext = createContext(null);

function readStoredCollectionId() {
  if (typeof window === 'undefined') {
    return null;
  }

  const rawValue = window.localStorage.getItem(activeCollectionStorageKey);
  const parsedValue = Number(rawValue);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function writeStoredCollectionId(collectionId) {
  if (typeof window === 'undefined') {
    return;
  }

  if (!Number.isInteger(collectionId) || collectionId <= 0) {
    window.localStorage.removeItem(activeCollectionStorageKey);
    return;
  }

  window.localStorage.setItem(activeCollectionStorageKey, String(collectionId));
}

function pickActiveCollectionId(collections, preferredId) {
  if (!collections.length) {
    return null;
  }

  const hasPreferred = Number.isInteger(preferredId)
    ? collections.some((collection) => collection.id === preferredId)
    : false;

  if (hasPreferred) {
    return preferredId;
  }

  const defaultCollection = collections.find((collection) => Number(collection.is_default) === 1);

  if (defaultCollection) {
    return defaultCollection.id;
  }

  const namedDefaultCollection = collections.find(
    (collection) => String(collection.name ?? '').trim().toLowerCase() === 'default',
  );

  return namedDefaultCollection?.id ?? collections[0].id;
}

function CollectionsProvider({ children }) {
  const [collections, setCollections] = useState([]);
  const [activeCollectionId, setActiveCollectionId] = useState(() => readStoredCollectionId());
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [collectionsError, setCollectionsError] = useState('');

  async function refreshCollections({ preferredCollectionId } = {}) {
    setLoadingCollections(true);
    setCollectionsError('');

    try {
      const payload = await getCollections();
      const nextCollections = payload.collections ?? [];
      setCollections(nextCollections);

      const nextActiveCollectionId = pickActiveCollectionId(
        nextCollections,
        preferredCollectionId ?? activeCollectionId ?? readStoredCollectionId(),
      );

      setActiveCollectionId(nextActiveCollectionId);
      writeStoredCollectionId(nextActiveCollectionId);
    } catch (error) {
      setCollectionsError(error.message);
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
  // (blanking the table), resets the active collection, and can drop the
  // caller's just-landed focus — none of which a one-row change should do.
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
    applyCollectionRow(createdCollection);

    // The default is where new notes land, so a brand-new collection becomes
    // the active one — but only that switch, not a whole reload.
    if (createdCollection?.id != null) {
      setActiveCollectionId(createdCollection.id);
      writeStoredCollectionId(createdCollection.id);
    }

    return createdCollection;
  }

  async function handleRenameCollection(collectionId, name) {
    const payload = await renameCollection(collectionId, name);
    applyCollectionRow(payload.collection);
    return payload.collection;
  }

  async function handleSetDefaultCollection(collectionId) {
    const payload = await setDefaultCollection(collectionId);

    // Exactly one collection is the default, so clear the others locally too.
    setCollections((current) =>
      current.map((collection) => ({
        ...collection,
        is_default: collection.id === collectionId ? 1 : 0,
      })),
    );
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
    const fallbackCollection =
      collections[index + 1] ??
      collections[index - 1] ??
      collections.find((collection) => collection.id !== collectionId) ??
      null;

    await deleteCollection(collectionId);

    const remaining = collections.filter(
      (collection) => collection.id !== collectionId,
    );
    setCollections(remaining);

    // Only move the active collection if the one being deleted held it.
    if (activeCollectionId === collectionId) {
      const nextActiveId = fallbackCollection?.id ?? null;
      setActiveCollectionId(nextActiveId);
      writeStoredCollectionId(nextActiveId);
    }
  }

  function selectCollection(collectionId) {
    const normalizedId = Number(collectionId);
    if (!Number.isInteger(normalizedId) || !collections.some((entry) => entry.id === normalizedId)) {
      return;
    }

    setActiveCollectionId(normalizedId);
    writeStoredCollectionId(normalizedId);
  }

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === activeCollectionId) ?? null,
    [activeCollectionId, collections],
  );

  const value = useMemo(
    () => ({
      activeCollection,
      activeCollectionId,
      collections,
      collectionsError,
      createCollection: handleCreateCollection,
      deleteCollection: handleDeleteCollection,
      loadingCollections,
      refreshCollections,
      renameCollection: handleRenameCollection,
      reorderCollections: handleReorderCollections,
      selectCollection,
      setDefaultCollection: handleSetDefaultCollection,
    }),
    [
      activeCollection,
      activeCollectionId,
      collections,
      collectionsError,
      loadingCollections,
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
