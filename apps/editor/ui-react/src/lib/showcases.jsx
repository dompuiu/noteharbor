import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createShowcase as createShowcaseRequest,
  deleteShowcase as deleteShowcaseRequest,
  getShowcases,
  renameShowcase as renameShowcaseRequest,
  reorderShowcases as reorderShowcasesRequest,
} from './api.js';

const ShowcasesContext = createContext(null);

// The workspace's showcases, shared by the sidebar (the showcase list) and the
// showcase screens. It follows the collections provider: load once on mount,
// then reconcile from a single server row after a mutation instead of
// refetching the whole list.
function ShowcasesProvider({ children }) {
  const [showcases, setShowcases] = useState([]);
  const [loadingShowcases, setLoadingShowcases] = useState(true);
  const [showcasesError, setShowcasesError] = useState('');
  // A not-yet-saved showcase started from `+ New showcase`. It renders as a
  // draft row in the sidebar and an empty edit canvas; Save POSTs it, while
  // Cancel or leaving the `new` route discards it without a request.
  const [pendingShowcase, setPendingShowcase] = useState(null);

  async function refreshShowcases() {
    setLoadingShowcases(true);
    setShowcasesError('');

    try {
      const payload = await getShowcases();
      setShowcases(payload.showcases ?? []);
    } catch (error) {
      setShowcasesError(error.message);
    } finally {
      setLoadingShowcases(false);
    }
  }

  useEffect(() => {
    refreshShowcases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateShowcase(name) {
    const payload = await createShowcaseRequest(name);
    const createdShowcase = payload.showcase;

    if (createdShowcase) {
      // A new showcase has the highest display_order, so it appends.
      setShowcases((current) => [...current, createdShowcase]);
      // A pending draft (if any) is now real; drop it so the sidebar shows
      // only the server row.
      setPendingShowcase(null);
    }

    return createdShowcase;
  }

  function beginPendingShowcase() {
    setPendingShowcase((current) => current ?? { id: 'new', name: 'Showcase' });
  }

  function discardPendingShowcase() {
    setPendingShowcase(null);
  }

  // Reconcile the list from a single server row after a mutation, rather than
  // refetching every showcase. A full refresh flips `loadingShowcases`, which
  // would blank the sidebar and the screen mid-edit.
  function applyShowcaseRow(updatedShowcase) {
    if (!updatedShowcase) {
      return;
    }

    setShowcases((current) =>
      current.map((showcase) =>
        showcase.id === updatedShowcase.id
          ? { ...showcase, ...updatedShowcase }
          : showcase,
      ),
    );
  }

  async function handleRenameShowcase(showcaseId, name) {
    const payload = await renameShowcaseRequest(showcaseId, name);
    applyShowcaseRow(payload.showcase);
    return payload.showcase;
  }

  async function handleReorderShowcases(ids) {
    const payload = await reorderShowcasesRequest(ids);
    const nextShowcases = payload.showcases ?? [];
    // Apply the server's order directly instead of refetching: a reorder is
    // not a load, and flipping the loading flag would blank the list mid-drag.
    setShowcases(nextShowcases);
    return nextShowcases;
  }

  // Deleting hands back the showcase that follows in display order so the
  // caller can open it; when the deleted showcase was last, there is none and
  // the caller falls back to the collections home.
  async function handleDeleteShowcase(showcaseId) {
    const index = showcases.findIndex((showcase) => showcase.id === showcaseId);
    const nextShowcase = showcases[index + 1] ?? null;

    await deleteShowcaseRequest(showcaseId);
    setShowcases((current) =>
      current.filter((showcase) => showcase.id !== showcaseId),
    );

    return { nextShowcaseId: nextShowcase?.id ?? null };
  }

  const value = useMemo(
    () => ({
      showcases,
      loadingShowcases,
      showcasesError,
      pendingShowcase,
      beginPendingShowcase,
      discardPendingShowcase,
      createShowcase: handleCreateShowcase,
      deleteShowcase: handleDeleteShowcase,
      refreshShowcases,
      renameShowcase: handleRenameShowcase,
      reorderShowcases: handleReorderShowcases,
    }),
    [showcases, loadingShowcases, showcasesError, pendingShowcase],
  );

  return (
    <ShowcasesContext.Provider value={value}>
      {children}
    </ShowcasesContext.Provider>
  );
}

function useShowcases() {
  const context = useContext(ShowcasesContext);

  if (!context) {
    throw new Error('useShowcases must be used inside ShowcasesProvider.');
  }

  return context;
}

export { ShowcasesProvider, useShowcases };
