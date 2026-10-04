import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { CollectionsScreen } from "./components/CollectionsScreen.jsx";
import { ConnectionError } from "./components/ConnectionError.jsx";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { NoCollectionsPrompt } from "./components/NoCollectionsPrompt.jsx";
import { NotesTable } from "./components/NotesTable.jsx";
import { PortfolioScreen } from "./components/PortfolioScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { getHealth } from "./lib/api.js";
import { CollectionsProvider, useCollections } from "./lib/collections.jsx";
import { isEmptyLibrary } from "./lib/libraryState.js";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  PORTFOLIO_ROUTES,
} from "./lib/routes.js";

// The two Portfolio destinations are undefined for now, so their copy stays a
// neutral "coming soon" rather than describing behaviour the spec hasn't set.
const PORTFOLIO_PAGES = [
  {
    description: "The Categories destination is a placeholder for now.",
    path: PORTFOLIO_ROUTES.categories,
    title: "Categories",
  },
  {
    description: "The Groupings destination is a placeholder for now.",
    path: PORTFOLIO_ROUTES.groupings,
    title: "Groupings",
  },
];

// The note editor can't open onto a collection that doesn't exist, so an empty
// library explains the two ways to get data instead of showing a dead form.
function NoteEditorDestination({ emptyLibrary, selectedCollectionId }) {
  if (emptyLibrary) {
    return (
      <section className="screen-stack narrow-stack">
        <div className="panel">
          <div className="panel-heading">
            <div className="panel-heading-copy">
              <h1>Banknotes</h1>
            </div>
          </div>
          <NoCollectionsPrompt />
        </div>
      </section>
    );
  }

  return <NoteEditForm selectedCollectionId={selectedCollectionId} />;
}

function ShellContent() {
  const {
    activeCollection,
    activeCollectionId,
    collections,
    collectionsError,
    loadingCollections,
    refreshCollections,
    selectCollection,
  } = useCollections();

  // The shared chrome can't work without the server behind it, so the whole
  // main region answers to one connection check rather than each screen
  // reporting the same outage differently.
  const [connection, setConnection] = useState({ status: "checking" });
  const [checkingConnection, setCheckingConnection] = useState(false);
  // The sidebar's Escape/Tab-out hands focus here, so it lands inside the page
  // rather than on <body>. Inert and visually hidden; Tab skips past it.
  const pageFocusRef = useRef(null);
  // A degraded server can answer slowly; a check that lands after unmount must
  // not write state (or overwrite a later retry).
  const mountedRef = useRef(true);

  async function checkConnection({ refreshOnSuccess = false } = {}) {
    const result = await getHealth();

    if (!mountedRef.current) {
      return;
    }

    if (!result.connected) {
      setConnection({ status: "disconnected", reason: result.reason });
      return;
    }

    // Only on a retry: the provider already loaded on mount, so re-running it
    // here is what actually brings the data back after an outage.
    if (refreshOnSuccess) {
      await refreshCollections();

      if (!mountedRef.current) {
        return;
      }
    }

    setConnection({ status: "ok" });
  }

  useEffect(() => {
    // Re-arm on every effect run. StrictMode mounts, runs cleanup, then runs the
    // effect again; without this the second check would see the ref left false
    // by the first cleanup and never leave the "checking" state.
    mountedRef.current = true;
    checkConnection();

    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetry() {
    setCheckingConnection(true);
    checkConnection({ refreshOnSuccess: true }).finally(() =>
      setCheckingConnection(false),
    );
  }

  const showEmptyLibrary = isEmptyLibrary({
    collections,
    collectionsError,
    loadingCollections,
  });

  return (
    <div className="app-shell">
      <Sidebar pageFocusRef={pageFocusRef} />
      <div className="app-main">
        <main>
          <span
            aria-hidden="true"
            className="page-focus-anchor"
            ref={pageFocusRef}
            tabIndex={-1}
          />
          {connection.status === "checking" ? (
            <p aria-live="polite" className="muted" role="status">
              Connecting...
            </p>
          ) : null}
          {connection.status === "disconnected" ? (
            <ConnectionError
              checking={checkingConnection}
              onRetry={handleRetry}
              reason={connection.reason}
            />
          ) : null}
          {connection.status === "ok" ? (
            <Routes>
              <Route
                element={
                  <NotesTable
                    activeCollection={activeCollection}
                    activeCollectionId={activeCollectionId}
                    collections={collections}
                    collectionsError={collectionsError}
                    loadingCollections={loadingCollections}
                    onSelectCollection={selectCollection}
                  />
                }
                path={CATALOG_ROUTES.banknotes}
              />
              <Route
                element={<CollectionsScreen />}
                path={CATALOG_ROUTES.collections}
              />
              <Route
                element={(
                  <ImportScreen
                    activeCollection={activeCollection}
                    activeCollectionId={activeCollectionId}
                    collections={collections}
                    collectionsError={collectionsError}
                    loadingCollections={loadingCollections}
                    onSelectCollection={selectCollection}
                  />
                )}
                path={CATALOG_ROUTES.importExport}
              />
              <Route
                element={
                  <NoteEditorDestination
                    emptyLibrary={showEmptyLibrary}
                    selectedCollectionId={activeCollectionId}
                  />
                }
                path={CATALOG_ROUTES.noteEdit(":id")}
              />
              {PORTFOLIO_PAGES.map((page) => (
                <Route
                  element={
                    <PortfolioScreen
                      description={page.description}
                      title={page.title}
                    />
                  }
                  key={page.path}
                  path={page.path}
                />
              ))}
              <Route
                element={<Navigate replace to={DEFAULT_DESTINATION} />}
                path="*"
              />
            </Routes>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Shell() {
  return (
    <CollectionsProvider>
      <ShellContent />
    </CollectionsProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}

export { ShellContent };
export default App;
