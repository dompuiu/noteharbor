import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import { CollectionsScreen } from "./components/CollectionsScreen.jsx";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { NotesTable } from "./components/NotesTable.jsx";
import { PortfolioScreen } from "./components/PortfolioScreen.jsx";
import { Sidebar } from "./components/Sidebar.jsx";
import { CollectionsProvider, useCollections } from "./lib/collections.jsx";
import { CATALOG_ROUTES, PORTFOLIO_ROUTES } from "./lib/routes.js";

function ShellContent() {
  const {
    activeCollection,
    activeCollectionId,
    collections,
    collectionsError,
    createCollection,
    deleteCollection,
    loadingCollections,
    renameCollection,
    selectCollection,
    setDefaultCollection,
  } = useCollections();

  const shouldForceImport = !loadingCollections && collections.length === 0;

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <main>
          <Routes>
            <Route
              element={
                shouldForceImport
                  ? <Navigate replace to={CATALOG_ROUTES.importExport} />
                  : (
                      <NotesTable
                        activeCollection={activeCollection}
                        activeCollectionId={activeCollectionId}
                        collections={collections}
                        collectionsError={collectionsError}
                        loadingCollections={loadingCollections}
                        onSelectCollection={selectCollection}
                      />
                    )
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
                  onCreateCollection={createCollection}
                  onDeleteCollection={deleteCollection}
                  onRenameCollection={renameCollection}
                  onSelectCollection={selectCollection}
                  onSetDefaultCollection={setDefaultCollection}
                  showBackToTable={!shouldForceImport}
                />
              )}
              path={CATALOG_ROUTES.importExport}
            />
            <Route
              element={
                shouldForceImport
                  ? <Navigate replace to={CATALOG_ROUTES.importExport} />
                  : <NoteEditForm selectedCollectionId={activeCollectionId} />
              }
              path={CATALOG_ROUTES.noteEdit(":id")}
            />
            <Route
              element={(
                <PortfolioScreen
                  description="Categories will group notes by theme. This destination is not built yet."
                  title="Categories"
                />
              )}
              path={PORTFOLIO_ROUTES.categories}
            />
            <Route
              element={(
                <PortfolioScreen
                  description="Groupings will save named sets of notes. This destination is not built yet."
                  title="Groupings"
                />
              )}
              path={PORTFOLIO_ROUTES.groupings}
            />
            <Route
              element={<Navigate replace to={CATALOG_ROUTES.banknotes} />}
              path="/"
            />
          </Routes>
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
