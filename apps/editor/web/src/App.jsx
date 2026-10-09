import { useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { CollectionsScreen } from "./components/CollectionsScreen.jsx";
import { ConnectionError } from "./components/ConnectionError.jsx";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { NoCollectionsPrompt } from "./components/NoCollectionsPrompt.jsx";
import { NotesTable } from "./components/NotesTable.jsx";
import { ShowcaseScreen } from "./components/ShowcaseScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { getHealth } from "./lib/api.js";
import { CollectionsProvider, useCollections } from "./lib/collections.jsx";
import { isEmptyLibrary } from "./lib/libraryState.js";
import { ShowcasesProvider } from "./lib/showcases.jsx";
import {
  CATALOG_ROUTES,
  DEFAULT_DESTINATION,
  SHOWCASE_ROUTES,
} from "./lib/routes.js";

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

// A bare `/portfolio/showcases/:id` URL (the pre-`view`-segment shape, and any
// hand-typed mode-less link) lands on the view mode with the query kept, so a
// `?node=` deep link still drills.
function LegacyShowcaseRedirect() {
  const { id } = useParams();
  const location = useLocation();
  return (
    <Navigate
      replace
      to={{ pathname: SHOWCASE_ROUTES.showcase(id), search: location.search }}
    />
  );
}

function ShellContent() {
  const {
    activeCollection,
    activeCollectionId,
    collections,
    collectionsError,
    collectionsErrorReason,
    loadingCollections,
    refreshCollections,
    selectCollection,
  } = useCollections();

  // The connection state is read from the collections load the provider already
  // performs on mount, so no health probe sits in front of the first paint.
  // A failed manual retry can pin its own reason until the next successful load.
  const [retryReason, setRetryReason] = useState(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  // The sidebar's Escape/Tab-out hands focus here, so it lands inside the page
  // rather than on <body>. Inert and visually hidden; Tab skips past it.
  const pageFocusRef = useRef(null);

  // A failed retry pins its reason; a collections load that later succeeds
  // proves the connection is back, so drop the pin.
  useEffect(() => {
    if (!collectionsError && !loadingCollections) {
      setRetryReason(null);
    }
  }, [collectionsError, loadingCollections]);

  async function handleRetry() {
    setCheckingConnection(true);

    try {
      const result = await getHealth();

      if (!result.connected) {
        setRetryReason(result.reason ?? "generic");
        return;
      }

      setRetryReason(null);
      await refreshCollections();
    } finally {
      setCheckingConnection(false);
    }
  }

  // A pinned retry reason is the most recent check, so it wins over the reason
  // recorded by the collections load.
  const loadReason = collectionsError
    ? collectionsErrorReason ?? "generic"
    : null;
  const disconnectedReason = retryReason ?? loadReason;

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
          {disconnectedReason ? (
            <ConnectionError
              checking={checkingConnection}
              onRetry={handleRetry}
              reason={disconnectedReason}
            />
          ) : (
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
                    collections={collections}
                    collectionsError={collectionsError}
                    loadingCollections={loadingCollections}
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
              <Route
                element={<ShowcaseScreen mode="view" />}
                path={SHOWCASE_ROUTES.showcase(":id")}
              />
              <Route
                element={<ShowcaseScreen mode="edit" />}
                path={SHOWCASE_ROUTES.showcaseEdit(":id")}
              />
              <Route
                element={<LegacyShowcaseRedirect />}
                path="/portfolio/showcases/:id"
              />
              <Route
                element={<Navigate replace to={DEFAULT_DESTINATION} />}
                path="*"
              />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}

function Shell() {
  return (
    <CollectionsProvider>
      <ShowcasesProvider>
        <ShellContent />
      </ShowcasesProvider>
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
