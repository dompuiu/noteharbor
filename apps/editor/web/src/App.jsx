import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { NotesTable } from "./components/NotesTable.jsx";
import { CollectionsProvider, useCollections } from "./lib/collections.jsx";
import { CATALOG_ROUTES } from "./lib/routes.js";

function ShellContent() {
  const { pathname } = useLocation();
  const isWideLayout = pathname === CATALOG_ROUTES.banknotes;
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
    <div className={`app-shell${isWideLayout ? " app-shell--wide" : ""}`}>
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
            element={<Navigate replace to={CATALOG_ROUTES.banknotes} />}
            path="/"
          />
        </Routes>
      </main>
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
