import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createCollection,
  deleteCollection,
  getCollections,
  renameCollection,
  reorderCollections,
} from './api.js';
import { isConnectionReason, subscribeConnectionFailure } from './connection.js';

const CollectionsContext = createContext(null);

function CollectionsProvider({ children }) {
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [collectionsError, setCollectionsError] = useState('');
  // Why the last load failed, in the shell's connection vocabulary ('server',
  // 'database', 'generic'). The shell reads its connection state from this load
  // instead of running a separate health probe before the first paint.
  const [collectionsErrorReason, setCollectionsErrorReason] = useState(null);
  // A connection failure reported by a screen's load after boot. Unlike
  // `collectionsErrorReason` it is not tied to this provider's own load, so a
  // dead server on a route change reaches the same card as a dead server at
  // boot. Only server/database failures qualify; everything else stays with
  // the screen that failed.
  const [connectionLostReason, setConnectionLostReason] = useState(null);
  // A not-yet-saved collection started from `+ New collection`. It renders as
  // a draft row in the sidebar and an empty edit canvas; Save POSTs it, while
  // Cancel or leaving the `new` route discards it without a request.
  const [pendingCollection, setPendingCollection] = useState(null);
  // The staged row as it stands right now, kept in step by the handlers below
  // rather than derived on render. A Save clears the state and navigates in
  // one batch, so the route-change effect still sees a stale `pendingCollection`;
  // this ref lets it tell "saved" from "discarded" and announce only the real
  // discard.
  const pendingCollectionRef = useRef(null);

  async function refreshCollections() {
    setLoadingCollections(true);
    setCollectionsError('');
    setCollectionsErrorReason(null);

    try {
      const payload = await getCollections();
      const nextCollections = payload.collections ?? [];
      setCollections(nextCollections);
      // A load that lands proves the connection is back.
      setConnectionLostReason(null);
    } catch (error) {
      setCollectionsError(error.message);
      setCollectionsErrorReason(error.reason ?? 'generic');
      markDisconnected(error.reason);
    } finally {
      setLoadingCollections(false);
    }
  }

  function markDisconnected(reason) {
    if (isConnectionReason(reason)) {
      setConnectionLostReason(reason);
    }
  }

  useEffect(() => {
    refreshCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A screen's load can discover the server or database is gone, so the shell
  // listens where loads report instead of each parent handing it up.
  useEffect(
    () => subscribeConnectionFailure(markDisconnected),
    // `markDisconnected` only calls a state setter; subscribing once keeps the
    // listener stable for the provider's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

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

  // One writer for the staged row: the ref answers synchronously (a discard is
  // one-shot) and the state is what the rail renders, so they never drift.
  function stagePendingCollection(next) {
    pendingCollectionRef.current = next;
    setPendingCollection(next);
  }

  async function handleCreateCollection(name) {
    const payload = await createCollection(name);
    const createdCollection = payload.collection;

    if (createdCollection) {
      applyCollectionRow(createdCollection);
      // A pending draft (if any) is now real; drop it so the sidebar shows
      // only the server row. Clearing both says the draft was saved, not
      // discarded.
      stagePendingCollection(null);
    }

    return createdCollection;
  }

  function beginPendingCollection() {
    if (!pendingCollectionRef.current) {
      stagePendingCollection({ id: 'new', name: 'Collection' });
    }
  }

  // The draft's name follows the canvas field on every keystroke, so the rail
  // reads the name about to be saved rather than the placeholder it started
  // with. Nothing POSTs.
  function updatePendingCollectionName(name) {
    if (pendingCollectionRef.current) {
      stagePendingCollection({ ...pendingCollectionRef.current, name });
    }
  }

  // Answers true when this call dropped a staged row, so the caller announces
  // only a real discard and a Save's clear is never mistaken for one.
  function discardPendingCollection() {
    if (!pendingCollectionRef.current) {
      return false;
    }

    stagePendingCollection(null);
    return true;
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
      connectionLostReason,
      createCollection: handleCreateCollection,
      deleteCollection: handleDeleteCollection,
      loadingCollections,
      markDisconnected,
      pendingCollection,
      beginPendingCollection,
      updatePendingCollectionName,
      discardPendingCollection,
      refreshCollections,
      renameCollection: handleRenameCollection,
      reorderCollections: handleReorderCollections,
    }),
    [
      collections,
      collectionsError,
      collectionsErrorReason,
      connectionLostReason,
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
