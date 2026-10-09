import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { resolveGroupingCover } from "../lib/showcaseCovers.js";

// A Grouping card shows its cover: the manual cover when one is set, else the
// first Note beneath the Grouping, else a neutral gradient placeholder that
// still shows the name (presentation spec §3–4). It is presentation-only; the
// edit controls live beside it, not inside it. Activation differs by mode: the
// read-only presentation opens on a single click / Enter / Space, while the
// edit canvas keeps its double-click drill (ticket 09).
function ShowcaseGroupingCard({ node, onOpen, mode = "view" }) {
  const editMode = mode === "edit";
  const coverImage = firstAvailableNoteImage(resolveGroupingCover(node));

  return (
    <button
      aria-label={`Open grouping ${node.name}`}
      className="showcase-card showcase-card--grouping"
      data-showcase-node-id={node.id}
      onClick={editMode ? undefined : onOpen}
      onDoubleClick={editMode ? onOpen : undefined}
      role="button"
      tabIndex={0}
      type="button"
    >
      {coverImage ? (
        <img alt="" className="showcase-card-image" src={coverImage.path} />
      ) : (
        <span
          aria-hidden="true"
          className="showcase-card-cover showcase-card-cover--empty"
        />
      )}
      <span className="showcase-card-name">{node.name}</span>
    </button>
  );
}

export { ShowcaseGroupingCard };
