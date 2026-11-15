import { firstAvailableNoteImage } from "../lib/showcaseImages.js";
import {
  formatShowcaseCatalogNumber,
  showcaseNoteTitleParts,
} from "../lib/showcaseNoteLabels.js";
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
// Two layouts share one state language:
//
// - `labels` (Library label): the rail sits at the top with the grip and the
//   compact catalog code, the photo keeps a hairline well, and a metadata row
//   carries the date, denomination and grade.
// - `rail` (Auction rail): the photo keeps the left half while the identity
//   rail stacks catalog code, date, denomination and grade on the right.
//
// Both put ownership in a quiet full-width footer action, so Seen and Owned
// read the same in either layout. The state label is the ownership toggle and
// a sibling of the card button (buttons cannot nest); the photo never changes
// opacity or colour, because only the label says whether the record is owned.
function noteLabel(note) {
  return formatShowcaseCatalogNumber(note?.catalog_number, { compact: true });
}

// A card's visible identity: the entry's own catalog metadata, never the
// primary Note, because the position and the record are independent.
function cardLabel(node) {
  return isCatalogEntry(node)
    ? catalogEntryCaption(node.entry)
    : showcaseNoteTitleParts(node?.note).join(" · ") || "Untitled note";
}

function text(value) {
  return String(value ?? "").trim();
}

// The grade belongs to the specimen, not the position. An entry may hold
// several notes; the primary one is the record the card shows.
function gradeOf(note) {
  const grade = text(note?.grade);

  if (!grade) {
    return null;
  }

  return { company: text(note?.grading_company), value: grade };
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
// screen's post-write focus restore landing on the same control. The footer
// form spans the card under the photo; the state colour, not a fill, carries
// the ownership at rest.
function StateLabel({ label, node, note, onToggleOwned, state }) {
  const owned = state === "owned";

  return (
    <button
      aria-label={`${label} is ${state}. Mark as ${owned ? "not owned" : "owned"}`}
      className={`showcase-card-state showcase-card-state--${state} showcase-card-state--footer`}
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

function CatalogGrade({ grade, layout }) {
  if (!grade) {
    return null;
  }

  return (
    <span className={`showcase-catalog-grade showcase-catalog-grade--${layout}`}>
      <b>{grade.value}</b>
      {grade.company ? <span>{grade.company}</span> : null}
    </span>
  );
}

function CardPhoto({ image, label }) {
  return (
    <span className="showcase-card-image showcase-catalog-photo">
      {image ? (
        <img alt={label} src={image.path} />
      ) : (
        <span className="showcase-card-no-image">No image</span>
      )}
    </span>
  );
}

function CatalogCardFrame({ children, label, onClick, node, state, variant }) {
  return (
    <button
      aria-label={label}
      className={`showcase-card showcase-card--catalog showcase-card--${variant} showcase-card--${state}`}
      data-showcase-node-id={node?.id}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function ShowcaseCatalogCard({
  node,
  grip = null,
  layout = "labels",
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
  const source = entry ? node.entry : note;
  const code = noteLabel(source);
  const date = text(source?.issue_date);
  const denomination = text(source?.denomination);
  const metaLine = [date, denomination].filter(Boolean).join(" · ");
  const grade = gradeOf(note);

  if (state === "unseen") {
    const openFinder = () => onOpenFinder?.(node);

    if (layout === "rail") {
      return (
        <div
          className="showcase-cell showcase-catalog-cell"
          data-showcase-node-id={node?.id}
        >
          <CatalogCardFrame
            label={`${label} is unseen. Add notes`}
            node={node}
            onClick={openFinder}
            state={state}
            variant="rail"
          >
            <span className="showcase-catalog-body">
              <span className="showcase-catalog-wellshot">
                <ShowcaseCatalogWell />
              </span>
              <span className="showcase-catalog-rail">
                <span className="showcase-catalog-railtop">{grip}</span>
                <span className="showcase-catalog-kicker">Catalog</span>
                {code ? <span className="showcase-catalog-code">{code}</span> : null}
                {date ? <span className="showcase-catalog-date">{date}</span> : null}
                {denomination ? (
                  <span className="showcase-catalog-denom">{denomination}</span>
                ) : null}
                <span className="showcase-catalog-empty">
                  No specimen recorded yet.
                </span>
              </span>
            </span>
            <span className="showcase-catalog-add">Add first note →</span>
          </CatalogCardFrame>
        </div>
      );
    }

    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
      >
        <CatalogCardFrame
          label={`${label} is unseen. Add notes`}
          node={node}
          onClick={openFinder}
          state={state}
          variant="labels"
        >
          <span className="showcase-catalog-topline">
            {grip}
            {code ? <span className="showcase-catalog-code">{code}</span> : null}
          </span>
          <span className="showcase-catalog-wellshot">
            <ShowcaseCatalogWell />
          </span>
          <span className="showcase-catalog-meta">
            <span className="showcase-catalog-line">{metaLine}</span>
          </span>
          <span className="showcase-catalog-add">Add first note →</span>
        </CatalogCardFrame>
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
  const activationLabel = entry ? `Slideshow from ${label}` : label;

  if (layout === "rail") {
    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
      >
        <CatalogCardFrame
          label={activationLabel}
          node={node}
          onClick={openBody}
          state={state}
          variant="rail"
        >
          <span className="showcase-catalog-body">
            <CardPhoto image={image} label={label} />
            <span className="showcase-catalog-rail">
              <span className="showcase-catalog-railtop">{grip}</span>
              <span className="showcase-catalog-kicker">Catalog</span>
              {code ? <span className="showcase-catalog-code">{code}</span> : null}
              {date ? <span className="showcase-catalog-date">{date}</span> : null}
              {denomination ? (
                <span className="showcase-catalog-denom">{denomination}</span>
              ) : null}
              <CatalogGrade grade={grade} layout="rail" />
            </span>
          </span>
        </CatalogCardFrame>
        <StateLabel
          label={label}
          node={node}
          note={note}
          onToggleOwned={onToggleOwned}
          state={state}
        />
      </div>
    );
  }

  return (
    <div
      className="showcase-cell showcase-catalog-cell"
      data-showcase-node-id={node?.id}
    >
      <CatalogCardFrame
        label={activationLabel}
        node={node}
        onClick={openBody}
        state={state}
        variant="labels"
      >
        <span className="showcase-catalog-topline">
          {grip}
          {code ? <span className="showcase-catalog-code">{code}</span> : null}
        </span>
        <CardPhoto image={image} label={label} />
        <span className="showcase-catalog-meta">
          <span className="showcase-catalog-line">{metaLine}</span>
          <CatalogGrade grade={grade} layout="labels" />
        </span>
      </CatalogCardFrame>
      <StateLabel
        label={label}
        node={node}
        note={note}
        onToggleOwned={onToggleOwned}
        state={state}
      />
    </div>
  );
}

export { ShowcaseCatalogCard };
