import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { resolveGroupingCover } from "../lib/showcaseCovers.js";

// A Grouping card shows its cover: the manual cover when one is set, else the
// first Note beneath the Grouping, else a neutral gradient placeholder that
// still shows the name (presentation spec §3–4). It is presentation-only; the
// edit controls live beside it, not inside it. Both view and edit mode open on
// a single click / Enter / Space. The footer carries a folder glyph so a
// Grouping reads as a container next to a Note; the glyph is inline at 1em so
// the footer keeps the Note caption's line height.
function ShowcaseGroupingCard({ node, onOpen }) {
  const coverImage = firstAvailableNoteImage(resolveGroupingCover(node));

  return (
    <button
      aria-label={`Open grouping ${node.name}`}
      className="showcase-card showcase-card--grouping"
      data-showcase-node-id={node.id}
      onClick={onOpen}
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
      <span className="showcase-card-name">
        <svg
          aria-hidden="true"
          className="showcase-card-name-icon"
          focusable="false"
          height="16"
          viewBox="0 0 24 24"
          width="16"
        >
          <path
            d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="showcase-card-name-text">{node.name}</span>
      </span>
    </button>
  );
}

export { ShowcaseGroupingCard };
