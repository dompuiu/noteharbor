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

function ShellContent() {
  const {
    activeCollection,
    activeCollectionId,
    collections,
    collectionsError,
    loadingCollections,
    selectCollection,
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
                  onSelectCollection={selectCollection}
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
