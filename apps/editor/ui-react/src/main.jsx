import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
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
// port, so the per-collection table structures are restored from the
// file-backed preferences before the first render reads them.
hydrateDesktopTableStates()
  .catch(() => {})
  .finally(renderApp);
