import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import {
  catalogEntryCaption,
  catalogEntryIdentity,
  primarySpecimen,
  specimenSummary,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// Edit-mode controls for one Catalog entry. The card mirrors the view-mode
// card's body (primary photo or the unseen well, the entry's own caption, and
// the quiet specimen line) but every action is draft-only: the card opens the
// local specimen manager, "Edit details" opens the metadata form, and the
// remove icon drops the position. Save replays the whole entry.
function ShowcaseCatalogEditor({
  node,
  onEditDetails,
  onManageNotes,
  onRemove,
}) {
  const entry = node?.entry ?? {};
  const identity = catalogEntryIdentity(entry);
  const caption = catalogEntryCaption(entry);
  const specimens = node?.specimens ?? [];
  const primary = primarySpecimen(node);
  const image = firstAvailableNoteImage(primary);
  const specimenLine = specimens.length
    ? specimenSummary(node)
    : "Add notes";

  return (
    <div
      className="showcase-cell showcase-catalog-cell"
      data-showcase-node-id={node.id}
    >
      <button
        aria-label={`Remove catalog entry ${identity}`}
        className="showcase-note-remove"
        data-showcase-action="remove"
        onClick={() => onRemove(node)}
        title="Remove catalog entry"
        type="button"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          height="14"
          viewBox="0 0 24 24"
          width="14"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      </button>

      <div className="showcase-catalog-editcard">
        <button
          aria-haspopup="dialog"
          aria-label={`${caption}. ${
            specimens.length ? `${specimenLine}. ` : ""
          }Manage notes`}
          className="showcase-card showcase-card--catalog showcase-catalog-edit-open"
          data-showcase-node-id={node.id}
          onClick={() => onManageNotes(node)}
          type="button"
        >
          {image ? (
            <span className="showcase-card-image">
              <img alt="" src={image.path} />
            </span>
          ) : (
            <ShowcaseCatalogWell identity={identity} />
          )}
          <span className="showcase-card-caption-row">
            <span className="showcase-card-caption">{caption}</span>
          </span>
          {entry.source ? (
            <span className="showcase-catalog-edit-source">{entry.source}</span>
          ) : null}
          <span className="showcase-catalog-foot">
            <span aria-hidden="true" className="showcase-check-empty" />
            <span>{specimenLine}</span>
            <span aria-hidden="true" className="showcase-catalog-arrow">
              →
            </span>
          </span>
        </button>

        <div className="showcase-cell-controls">
          <button
            className="button"
            data-showcase-action="edit-entry"
            onClick={() => onEditDetails(node)}
            type="button"
          >
            Edit details
          </button>
        </div>
      </div>
    </div>
  );
}

export { ShowcaseCatalogEditor };
