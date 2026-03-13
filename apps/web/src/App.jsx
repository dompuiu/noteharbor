import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { ImportScreen } from './components/ImportScreen.jsx';
import { NoteEditForm } from './components/NoteEditForm.jsx';
import { NotesTable } from './components/NotesTable.jsx';
import { ScrapeScreen } from './components/ScrapeScreen.jsx';
import { Slideshow } from './components/Slideshow.jsx';

function Shell() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">Local collection studio</p>
          <h1 className="site-title">Notesshow</h1>
        </div>
        <nav className="site-nav">
          <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/">
            Table
          </NavLink>
          <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/import">
            Import
          </NavLink>
          <NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/scrape">
            Scrape
          </NavLink>
        </nav>
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
