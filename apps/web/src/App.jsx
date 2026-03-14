import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { ImportScreen } from "./components/ImportScreen.jsx";
import { NoteEditForm } from "./components/NoteEditForm.jsx";
import { NotesTable } from "./components/NotesTable.jsx";
import { ScrapeScreen } from "./components/ScrapeScreen.jsx";
import { Slideshow } from "./components/Slideshow.jsx";

function Shell() {
  const { pathname } = useLocation();
  const isWideLayout = pathname === "/" || pathname === "/scrape";
  return (
    <div className={`app-shell${isWideLayout ? " app-shell--wide" : ""}`}>
      <header className="site-header">
        <div>
          <p className="eyebrow">Local collection studio</p>
          <Link className="site-title-link" to="/">
            <h1 className="site-title">Notesshow</h1>
          </Link>
        </div>
      </header>

      <main>
        <Routes>
          <Route element={<NotesTable />} path="/" />
          <Route element={<ImportScreen />} path="/import" />
          <Route element={<NoteEditForm />} path="/notes/:id/edit" />
          <Route element={<ScrapeScreen />} path="/scrape" />
          <Route element={<Slideshow />} path="/slideshow" />
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
