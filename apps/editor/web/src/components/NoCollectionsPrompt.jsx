import { Link } from "react-router-dom";
import { CATALOG_ROUTES } from "../lib/routes.js";

// An empty library, not an outage: there is nothing to show yet, and a note
// can't exist without a collection. So the two ways forward are the two ways
// data can arrive. Rendered inside the banknote table's empty cell and inside
// the note editor's panel.
function NoCollectionsPrompt() {
  return (
    <div className="no-collections-prompt">
      <p className="muted">
        No collections yet. Import an archive or create a collection to start
        adding banknotes.
      </p>
      <div className="inline-actions">
        <Link
          className="button button-primary"
          to={CATALOG_ROUTES.importExport}
        >
          Import / Export
        </Link>
        <Link className="button" to={CATALOG_ROUTES.collections}>
          Create a collection
        </Link>
      </div>
    </div>
  );
}

export { NoCollectionsPrompt };
