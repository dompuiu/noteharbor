import { AnchoredPopover } from "./AnchoredPopover.jsx";
import { handleMenuNavigation } from "../lib/menuNavigation.js";
import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";
import {
  catalogEntryCaption,
  catalogEntryIdentity,
  isCatalogEntry,
  nodeCatalogState,
  primarySpecimen,
  specimenSummary,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";

// One card in a catalog Showcase. A Catalog entry and a note leaf share the
// three states the checklist paints (owned, seen, unseen); they differ only in
// what the body opens and whether the multi-specimen strip exists. The card
// itself is one button so keyboard navigation still sees one card per grid
// cell; the check and the strip sit beside it and fall back to the card when a
// shortcut starts on them.
//
// Owned: the primary photo, a white check disc that opens the ownership menu.
// Seen: the primary photo desaturated, a SEEN tag, and an ownership footer
// (the card itself is the menu trigger).
// Unseen: a recessed specimen well carrying the catalog identity; the whole
// card opens the note finder.
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

function StackIcon() {
  return (
    <svg
      aria-hidden="true"
      className="showcase-catalog-strip-icon"
      focusable="false"
      height="12"
      viewBox="0 0 24 24"
      width="12"
    >
      <rect
        fill="none"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="2"
        width="13"
        x="8"
        y="3"
      />
      <path
        d="M4 7v11a2 2 0 0 0 2 2h11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="showcase-catalog-caret"
      focusable="false"
      height="12"
      viewBox="0 0 24 24"
      width="12"
    >
      <path
        d="m6 9 6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

// The ownership menu is the same for a check disc and a seen footer: a header
// naming the card's state, the library-wide ownership toggle naming the
// displayed note, and (for an entry with specimens) the way into the specimen
// manager. The trigger is supplied so the card can keep one card-level button.
function OwnershipMenu({
  node,
  note,
  renderTrigger,
  state,
  onOpenManager,
  onToggleOwned,
}) {
  const entry = isCatalogEntry(node);
  const owned = state === "owned";
  const displayedNote = note ? noteLabel(note) : "this note";
  const otherSpecimenOwned =
    entry &&
    note != null &&
    (node?.specimens ?? []).some(
      (specimen) => specimen?.id !== note.id && specimen?.owned,
    );
  const specimenCount = entry ? (node?.specimens ?? []).length : 0;
  const detail = owned
    ? otherSpecimenOwned
      ? "Another specimen still owns this entry."
      : entry
        ? "Keeps the note and its photos; this entry becomes seen."
        : "Keeps the note and its photos."
    : "Adds the check here and everywhere else this note appears.";

  return (
    <AnchoredPopover
      align="end"
      className="showcase-ownership-menu"
      initialFocus={(panel) =>
        panel.querySelector('[role="menuitem"]:not(:disabled)') ?? panel
      }
      onKeyDown={(event, panel) =>
        handleMenuNavigation(event, panel, '[role="menuitem"]')
      }
      panelLabel={`Ownership options for ${cardLabel(node)}`}
      role="menu"
      renderTrigger={renderTrigger}
    >
      {({ close }) => (
        <>
          <div className="showcase-ownership-head">
            <span className="showcase-ownership-identity">
              {entry ? catalogEntryIdentity(node.entry) : cardLabel(node)}
            </span>
            <span
              className={`showcase-ownership-state showcase-ownership-state--${state}`}
            >
              {owned ? "Owned" : "Seen"}
            </span>
          </div>
          <button
            className="showcase-ownership-item"
            onClick={() => {
              close({ returnFocus: true });
              onToggleOwned?.(note, !owned, node.id);
            }}
            role="menuitem"
            type="button"
          >
            <small>{displayedNote}</small>
            <b>
              {owned ? "Mark this note as not owned" : "Mark this note owned"}
            </b>
            <em>{detail}</em>
          </button>
          {entry && specimenCount > 0 ? (
            <button
              className="showcase-ownership-item"
              onClick={() => {
                close({ returnFocus: true });
                onOpenManager?.(node);
              }}
              role="menuitem"
              type="button"
            >
              <b>{`Notes on this entry (${specimenCount})…`}</b>
              <em>Add another specimen, or choose the primary.</em>
            </button>
          ) : null}
        </>
      )}
    </AnchoredPopover>
  );
}

function ShowcaseCatalogCard({
  node,
  onOpenFinder,
  onOpenManager,
  onOpenNote,
  onPresent,
  onToggleOwned,
}) {
  const entry = isCatalogEntry(node);
  const state = nodeCatalogState(node);
  const note = entry ? primarySpecimen(node) : node?.note;
  const image = firstAvailableNoteImage(note);
  const label = cardLabel(node);
  const specimenCount = entry ? (node?.specimens ?? []).length : 0;

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
          <ChevronIcon />
        </span>
      ) : null}
    </>
  );

  const strip =
    entry && specimenCount > 1 ? (
      <button
        aria-haspopup="dialog"
        aria-label={`${specimenCount} notes on this entry. Choose the primary`}
        className="showcase-catalog-strip"
        data-showcase-focus="strip"
        onClick={() => onOpenManager?.(node)}
        type="button"
      >
        <StackIcon />
        <span>{specimenSummary(node)}</span>
      </button>
    ) : null;

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
        <OwnershipMenu
          node={node}
          note={note}
          onOpenManager={onOpenManager}
          onToggleOwned={onToggleOwned}
          renderTrigger={({ triggerProps }) => (
            <button
              {...triggerProps}
              aria-label={`${label} is seen. Open ownership options`}
              className="showcase-card showcase-card--catalog showcase-card--seen"
              data-showcase-focus="ownership"
              data-showcase-node-id={node?.id}
              type="button"
            >
              {body}
            </button>
          )}
          state={state}
        />
        {strip}
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
        <OwnershipMenu
          node={node}
          note={note}
          onOpenManager={onOpenManager}
          onToggleOwned={onToggleOwned}
          renderTrigger={({ triggerProps }) => (
            <button
              {...triggerProps}
              aria-label={`${label} is owned. Open ownership options`}
              className="showcase-card-check"
              data-showcase-focus="check"
              title="Owned — open options"
              type="button"
            >
              <CheckIcon />
            </button>
          )}
          state={state}
        />
      </span>
      {strip}
    </div>
  );
}

export { ShowcaseCatalogCard };
