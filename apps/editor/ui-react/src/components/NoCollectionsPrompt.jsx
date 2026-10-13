import { Link } from "react-router-dom";
import { CATALOG_ROUTES, NEW_COLLECTION_ID } from "../lib/routes.js";

// An empty library, not an outage: there is nothing to show yet, and a note
// can't exist without a collection. So the two ways forward are the two ways
// data can arrive. Uses the shared dashed empty-state box so the collections
// home, the note editor, and the table's empty cell all read as one pattern.
function NoCollectionsPrompt() {
  return (
    <div className="showcase-empty-box no-collections-prompt">
      <svg
        aria-hidden="true"
        className="showcase-empty-art"
        focusable="false"
        height="48"
        viewBox="0 0 48 48"
        width="48"
      >
        <rect
          height="10"
          rx="3"
          width="30"
          x="9"
          y="8"
          fill="var(--surface)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          height="10"
          rx="3"
          width="30"
          x="9"
          y="19"
          fill="var(--surface)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <rect
          height="10"
          rx="3"
          width="30"
          x="9"
          y="30"
          fill="var(--surface)"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M14 13h9 M14 24h12 M14 35h7"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2"
        />
      </svg>
      <p className="showcase-empty-title">No collections yet.</p>
      <p className="showcase-empty-text muted">
        Collections organize your banknotes. Import an archive or create a
        collection to start adding notes.
      </p>
      <div className="showcase-empty-actions">
        <Link
          className="button button-primary"
          to={CATALOG_ROUTES.collectionEdit(NEW_COLLECTION_ID)}
        >
          Create a collection
        </Link>
        <Link className="button" to={CATALOG_ROUTES.importExport}>
          Import / Export
        </Link>
      </div>
    </div>
  );
}

export { NoCollectionsPrompt };
