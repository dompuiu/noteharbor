import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createShowcase as createShowcaseRequest, getShowcases } from './api.js';

const ShowcasesContext = createContext(null);

// The workspace's showcases, shared by the sidebar (the showcase list) and the
// showcase screens. It follows the collections provider: load once on mount,
// then reconcile from a single server row after a mutation instead of
// refetching the whole list.
function ShowcasesProvider({ children }) {
  const [showcases, setShowcases] = useState([]);
  const [loadingShowcases, setLoadingShowcases] = useState(true);
  const [showcasesError, setShowcasesError] = useState('');

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
    }

    return createdShowcase;
  }

  const value = useMemo(
    () => ({
      showcases,
      loadingShowcases,
      showcasesError,
      createShowcase: handleCreateShowcase,
      refreshShowcases,
    }),
    [showcases, loadingShowcases, showcasesError],
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
