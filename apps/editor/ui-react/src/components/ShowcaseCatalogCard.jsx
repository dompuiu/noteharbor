import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";
import {
  catalogEntryCaption,
  catalogEntryIdentity,
  isCatalogEntry,
  nodeCatalogState,
  primarySpecimen,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// One card in a catalog Showcase. A real note leaf is owned or seen; a catalog
// shell is always unseen. The card itself is one button so keyboard navigation
// still sees one card per grid cell; the ownership control sits beside it as a
// direct toggle, never a second menu (the item menu carries the same action).
//
// Owned: the note photo and a white check disc that marks it not owned.
// Seen: the note photo desaturated, a SEEN tag, and the card itself marks it
// owned.
// Unseen: a recessed shell well carrying the catalog identity; the whole card
// opens the finder that replaces the shell with a note.
function noteLabel(note) {
  return showcaseNoteDisplayParts(note).join(" · ") || "Untitled note";
}

// A card's visible identity: the entry's own catalog metadata, never the
// primary Note, because the position and the record are independent. The
// caption reads like a note card's (denomination · catalog · date); the unseen
// well keeps the shorter catalog value.
function cardLabel(node) {
  return isCatalogEntry(node)
    ? catalogEntryCaption(node.entry)
    : noteLabel(node?.note);
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height="15"
      viewBox="0 0 24 24"
      width="15"
    >
      <path
        d="m5 12.5 4.5 4.5L19 7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function ShowcaseCatalogCard({
  node,
  onOpenFinder,
  onOpenNote,
  onPresent,
  onToggleOwned,
}) {
  const entry = isCatalogEntry(node);
  const state = nodeCatalogState(node);
  const note = entry ? primarySpecimen(node) : node?.note;
  const image = firstAvailableNoteImage(note);
  const label = cardLabel(node);

  if (state === "unseen") {
    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
      >
        <button
          aria-haspopup="dialog"
          aria-label={`${label} is unseen. Add notes`}
          className="showcase-card showcase-card--catalog showcase-card--unseen"
          data-showcase-node-id={node?.id}
          onClick={() => onOpenFinder?.(node)}
          type="button"
        >
          <ShowcaseCatalogWell
            identity={entry ? catalogEntryIdentity(node.entry) : label}
          />
          <span className="showcase-card-caption-row">
            <span className="showcase-card-caption">{label}</span>
          </span>
          <span className="showcase-catalog-foot">
            <span aria-hidden="true" className="showcase-check-empty" />
            <span>Add notes</span>
            <span aria-hidden="true" className="showcase-catalog-arrow">
              →
            </span>
          </span>
        </button>
      </div>
    );
  }

  const body = (
    <>
      <span
        className={`showcase-card-image${state === "seen" ? " showcase-card-image--seen" : ""}`}
      >
        {image ? (
          <img alt={label} src={image.path} />
        ) : (
          <span className="showcase-card-no-image">No image</span>
        )}
        {state === "seen" ? (
          <span className="showcase-seen-tag">Seen</span>
        ) : null}
      </span>
      <span className="showcase-card-caption-row">
        <span className="showcase-card-caption">{label}</span>
      </span>
      {state === "seen" ? (
        <span className="showcase-catalog-foot">
          <span aria-hidden="true" className="showcase-check-empty" />
          <span>Mark owned</span>
        </span>
      ) : null}
    </>
  );

  const openBody = () => {
    if (entry) {
      onPresent?.(node);
      return;
    }

    onOpenNote?.(node, "front");
  };

  if (state === "seen") {
    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
      >
        <button
          aria-label={`${label} is seen. Mark as owned`}
          className="showcase-card showcase-card--catalog showcase-card--seen"
          data-showcase-focus="ownership"
          data-showcase-node-id={node?.id}
          onClick={() => onToggleOwned?.(note, true, node.id)}
          type="button"
        >
          {body}
        </button>
      </div>
    );
  }

  return (
    <div
      className="showcase-cell showcase-catalog-cell"
      data-showcase-node-id={node?.id}
    >
      <button
        aria-label={entry ? `Present ${label}` : label}
        className="showcase-card showcase-card--catalog showcase-card--owned"
        data-showcase-node-id={node?.id}
        onClick={openBody}
        type="button"
      >
        {body}
      </button>
      <span className="showcase-catalog-check">
        <button
          aria-label={`${label} is owned. Mark as not owned`}
          className="showcase-card-check"
          data-showcase-focus="check"
          onClick={() => onToggleOwned?.(note, false, node.id)}
          title="Owned — mark as not owned"
          type="button"
        >
          <CheckIcon />
        </button>
      </span>
    </div>
  );
}

export { ShowcaseCatalogCard };
