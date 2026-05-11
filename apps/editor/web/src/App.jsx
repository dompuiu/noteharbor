import {
  BrowserRouter,
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

  return (
    <div className={`app-shell${isWideLayout ? " app-shell--wide" : ""}`}>
      <main>
        <Routes>
          <Route
            element={(
              <NotesTable
                activeCollection={activeCollection}
                activeCollectionId={activeCollectionId}
                collections={collections}
                collectionsError={collectionsError}
                loadingCollections={loadingCollections}
                onSelectCollection={selectCollection}
              />
            )}
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
              />
            )}
            path="/import"
          />
          <Route
            element={<NoteEditForm selectedCollectionId={activeCollectionId} />}
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
