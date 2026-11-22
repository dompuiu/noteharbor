import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { hydrateDesktopAllNotesTableState } from './lib/allNotesColumns.js';
import { hydrateDesktopTableStates } from './lib/notesTableState.js';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root'));

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// The desktop shell's localStorage origin changes with the embedded server's
// port, so the saved table structures are restored from the file-backed
// preferences before the first render reads them.
Promise.all([
  hydrateDesktopTableStates(),
  hydrateDesktopAllNotesTableState(),
])
  .catch(() => {})
  .finally(renderApp);
