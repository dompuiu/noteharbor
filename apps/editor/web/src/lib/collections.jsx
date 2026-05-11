import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
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

  async function handleCreateCollection(name) {
    const payload = await createCollection(name);
    const createdCollection = payload.collection;
    await refreshCollections({ preferredCollectionId: createdCollection?.id ?? null });
    return createdCollection;
  }

  async function handleRenameCollection(collectionId, name) {
    const payload = await renameCollection(collectionId, name);
    await refreshCollections({ preferredCollectionId: collectionId });
    return payload.collection;
  }

  async function handleSetDefaultCollection(collectionId) {
    await setDefaultCollection(collectionId);
    await refreshCollections({ preferredCollectionId: collectionId });
  }

  async function handleDeleteCollection(collectionId) {
    const index = collections.findIndex((collection) => collection.id === collectionId);
    const fallbackCollection =
      collections[index + 1] ??
      collections[index - 1] ??
      collections.find((collection) => collection.id !== collectionId) ??
      null;

    await deleteCollection(collectionId);
    await refreshCollections({ preferredCollectionId: fallbackCollection?.id ?? null });
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
