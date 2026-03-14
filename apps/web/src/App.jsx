import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { HomeHero, NotesTable } from "./components/NotesTable.jsx";

function Shell() {
  const { pathname } = useLocation();
  const isWideLayout = pathname === "/";
  return (
    <div className={`app-shell${isWideLayout ? " app-shell--wide" : ""}`}>
      <header className="site-header">
        {isWideLayout ? <HomeHero /> : null}
      </header>

      <main>
        <Routes>
          <Route element={<NotesTable />} path="/" />
          <Route element={<ImportScreen />} path="/import" />
          <Route element={<NoteEditForm />} path="/notes/:id/edit" />
        </Routes>
      </main>
    </div>
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
