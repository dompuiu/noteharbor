import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";
import {
  catalogEntryCaption,
  isCatalogEntry,
  nodeCatalogState,
  primarySpecimen,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// One card in a catalog Showcase. A note leaf is owned or seen; a catalog shell
// is always unseen. The card body is one button that opens the note (or the
// shell's finder), so keyboard navigation still sees one card per grid cell.
//
// The state is a label pinned to the photo's corner: Seen and Owned share the
// same pill, and the label is the ownership toggle. The photo itself never
// changes opacity or colour: a seen note keeps its real image, because only the
// label says whether the record is owned.
function noteLabel(note) {
  return showcaseNoteDisplayParts(note).join(" · ") || "Untitled note";
}

// A card's visible identity: the entry's own catalog metadata, never the
// primary Note, because the position and the record are independent. The full
// line (denomination · catalog · date) is the cell's title bar, so the card
// body carries only the photo or the unseen well.
function cardLabel(node) {
  return isCatalogEntry(node)
    ? catalogEntryCaption(node.entry)
    : noteLabel(node?.note);
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="showcase-card-state-icon"
      focusable="false"
      height="11"
      viewBox="0 0 24 24"
      width="11"
    >
      <path
        d="m5 12.5 4.5 4.5L19 7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.2"
      />
    </svg>
  );
}

// The Seen and Owned labels are the toggle: clicking the picture never changes
// ownership, clicking the label always does. `data-showcase-focus` keeps the
// screen's post-write focus restore landing on the same control.
function StateLabel({ label, node, note, onToggleOwned, state }) {
  const owned = state === "owned";

  return (
    <button
      aria-label={`${label} is ${state}. Mark as ${owned ? "not owned" : "owned"}`}
      className={`showcase-card-state showcase-card-state--${state}`}
      data-showcase-focus={owned ? "check" : "ownership"}
      onClick={() => onToggleOwned?.(note, !owned, node.id)}
      title={owned ? "Owned — mark as not owned" : "Seen — mark as owned"}
      type="button"
    >
      {owned ? <CheckIcon /> : null}
      {owned ? "Owned" : "Seen"}
    </button>
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
          <ShowcaseCatalogWell />
        </button>
      </div>
    );
  }

  const openBody = () => {
    if (entry) {
      onPresent?.(node);
      return;
    }

    onOpenNote?.(node, "front");
  };

  return (
    <div
      className="showcase-cell showcase-catalog-cell"
      data-showcase-node-id={node?.id}
    >
      <StateLabel
        label={label}
        node={node}
        note={note}
        onToggleOwned={onToggleOwned}
        state={state}
      />
      <button
        aria-label={entry ? `Present ${label}` : label}
        className={`showcase-card showcase-card--catalog showcase-card--${state}`}
        data-showcase-node-id={node?.id}
        onClick={openBody}
        type="button"
      >
        <span className="showcase-card-image">
          {image ? (
            <img alt={label} src={image.path} />
          ) : (
            <span className="showcase-card-no-image">No image</span>
          )}
        </span>
      </button>
    </div>
  );
}

export { ShowcaseCatalogCard };
