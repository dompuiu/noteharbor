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

function ShellContent() {
  const { pathname } = useLocation();
  const isWideLayout = pathname === "/";
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
                ? <Navigate replace to="/import" />
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
            path="/"
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
            path="/import"
          />
          <Route
            element={
              shouldForceImport
                ? <Navigate replace to="/import" />
                : <NoteEditForm selectedCollectionId={activeCollectionId} />
            }
            path="/notes/:id/edit"
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

export default App;
