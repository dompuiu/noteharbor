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
import { isReadOnlyMode } from "./lib/appMode.js";

function Shell() {
  const { pathname } = useLocation();
  const isWideLayout = pathname === "/";
  return (
    <div className={`app-shell${isWideLayout ? " app-shell--wide" : ""}`}>
      <main>
        <Routes>
          <Route element={<NotesTable />} path="/" />
          <Route
            element={
              isReadOnlyMode ? <Navigate replace to="/" /> : <ImportScreen />
            }
            path="/import"
          />
          <Route
            element={
              isReadOnlyMode ? <Navigate replace to="/" /> : <NoteEditForm />
            }
            path="/notes/:id/edit"
          />
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
