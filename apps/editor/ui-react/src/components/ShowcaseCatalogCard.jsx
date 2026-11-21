import { useId, useRef, useState } from "react";
import {
  firstAvailableNoteImage,
  pickBackImage,
} from "../lib/showcaseImages.js";
import {
  formatShowcaseCatalogNumber,
  showcaseNoteTitleParts,
} from "../lib/showcaseNoteLabels.js";
import {
  catalogEntryCaption,
  isCatalogEntry,
  nodeCatalogState,
} from "../lib/showcaseTree.js";
import { ShowcaseCatalogWell } from "./ShowcaseCatalogWell.jsx";
import { ShowcaseCardNotes } from "./ShowcaseCardNotes.jsx";
import { ShowcaseFlipControl } from "./ShowcaseFlipControl.jsx";

// One card in a catalog Showcase. A note leaf is owned or seen; a catalog shell
// is always unseen. The card body is one button that opens the note (or the
// shell's finder), so keyboard navigation still sees one card per grid cell.
// A note with a distinct back reveals a two-arrow flip control in the photo's
// bottom-right on hover or focus; clicking it (or Shift/Ctrl + ←/→ on the
// focused card) shows the back until the pointer or focus leaves. Activating a
// note leaf keeps the visible face, so the image preview opens at the back when
// the back is showing.
// The actions menu sits after the card body in the DOM and before the ownership
// footer, so Tab walks card → dots → Show back → sibling chip → ownership; the
// menu never nests inside a button.
//
// Two layouts share one state language:
//
// - `labels` (Library label): the rail sits at the top with the grip and the
//   compact catalog code, the photo keeps a hairline well, and a metadata row
//   carries the denomination, date and grade.
// - `rail` (Auction rail): the photo takes the left width while the identity
//   rail stacks catalog code, denomination, date and grade on the right.
//
// Both put ownership in a quiet full-width footer action, so Seen and Owned
// read the same in either layout. The state label is the ownership toggle and
// a sibling of the card button (buttons cannot nest); the photo never changes
// opacity or colour, because only the label says whether the record is owned.
// Both leaves read their own free text through the same notes block, in the
// same place: two lines under the metadata in the Library label, four lines in
// the identity rail. A note's text is its record's notes; a placeholder's is
// the reminder the collector wrote while planning the card.
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

// The grade belongs to the note. An entry holds no note, so it has none.
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

// A quiet stack mark for the sibling chip: three offset notes, not an action
// glyph. It reads as "more of this" without competing with the card's photo.
function StackIcon() {
  return (
    <svg
      aria-hidden="true"
      className="showcase-card-siblings-icon"
      focusable="false"
      height="11"
      viewBox="0 0 24 24"
      width="11"
    >
      <path
        d="M7 4h10a2 2 0 0 1 2 2v9M4 8h10a2 2 0 0 1 2 2v10H6a2 2 0 0 1-2-2V8Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

// The sibling chip lives in the footer row, ahead of the ownership toggle, so
// it adds no card height. It renders only for a Note with siblings; a zero
// count leaves the footer exactly as it was.
function SiblingChip({ count, node, onOpen }) {
  const value = Number(count) || 0;

  if (value <= 0) {
    return null;
  }

  return (
    <button
      aria-label={`Show ${value} sibling ${value === 1 ? "note" : "notes"} with the same catalog number, denomination, and date`}
      className="showcase-card-siblings"
      data-showcase-focus="siblings"
      onClick={() => onOpen?.(node)}
      title={`${value} ${value === 1 ? "sibling" : "siblings"}`}
      type="button"
    >
      <StackIcon />
      <span>
        {value} {value === 1 ? "sibling" : "siblings"}
      </span>
    </button>
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

function CardPhoto({
  backPath,
  image,
  label,
  onFlipToggle,
  showFlip,
  swapped,
}) {
  const frontPath = image?.type === "front" ? image.path : null;
  const soleBack = image?.type === "back";
  const frontVisible = Boolean(frontPath) && !swapped;
  const backVisible = Boolean(backPath) && (swapped || soleBack);
  const backLabel = `${label} (back)`;

  return (
    <span className="showcase-card-image showcase-catalog-photo">
      {frontPath ? (
        <img
          alt={frontVisible ? label : ""}
          aria-hidden={frontVisible ? undefined : "true"}
          className={`showcase-card-face${frontVisible ? " showcase-card-face--visible" : ""}`}
          src={frontPath}
        />
      ) : null}
      {backPath ? (
        <img
          alt={backVisible ? (swapped ? backLabel : label) : ""}
          aria-hidden={backVisible ? undefined : "true"}
          className={`showcase-card-face${backVisible ? " showcase-card-face--visible" : ""}`}
          src={backPath}
        />
      ) : null}
      {!image ? (
        <span className="showcase-card-no-image">No image</span>
      ) : null}
      {showFlip ? (
        <ShowcaseFlipControl onToggle={onFlipToggle} swapped={swapped} />
      ) : null}
    </span>
  );
}

function CatalogCardFrame({
  buttonRef = null,
  children,
  describedBy,
  label,
  onClick,
  onKeyDown,
  node,
  pressed = false,
  state,
  toggleable = false,
  variant,
}) {
  return (
    <button
      aria-describedby={describedBy}
      aria-label={label}
      ref={buttonRef}
      // Only a card with a distinct back is a face toggle; a card that can
      // only open the viewer must not announce a pressed state it cannot
      // change.
      aria-pressed={
        state === "unseen" || !toggleable ? undefined : pressed
      }
      className={`showcase-card showcase-card--catalog showcase-card--${variant} showcase-card--${state}${pressed ? " showcase-card--back" : ""}`}
      data-showcase-node-id={node?.id}
      onClick={onClick}
      onKeyDown={onKeyDown}
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
  menu = null,
  onOpenFinder,
  onOpenNote,
  onOpenSiblings,
  onPresent,
  onToggleOwned,
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [flipped, setFlipped] = useState(false);
  // The card button a pointer click on the flip control parked focus on. On
  // pointer leave we blur only that button, so a mouse click never leaves the
  // chip behind, while a keyboard-focused card keeps it.
  const pointerFocusRef = useRef(null);
  const cardButtonRef = useRef(null);
  const notesId = useId();
  const entry = isCatalogEntry(node);
  const state = nodeCatalogState(node);
  const note = node?.note;
  const image = firstAvailableNoteImage(note);
  const backPath = pickBackImage(note);
  // A distinct back is a front primary with a back beside it. A back-only note
  // shows its sole image and never flips.
  const hasDistinctBack = image?.type === "front" && Boolean(backPath);
  const swapped = hasDistinctBack && flipped;
  const flipVisible = hasDistinctBack && (hovered || focused || flipped);
  const label = cardLabel(node);
  const source = entry ? node.entry : note;
  const code = noteLabel(source);
  const date = text(source?.issue_date);
  const denomination = text(source?.denomination);
  const metaLine = [denomination, date].filter(Boolean).join(" · ");
  const grade = gradeOf(note);
  const notes = text(note?.notes);
  // A placeholder's own reminder is not the specimen's notes: it lives on the
  // entry and reads only while the slot is unseen. It shares the block above.
  const placeholderNotes = text(node?.entry?.notes);
  const notesDescriptionId = notes || placeholderNotes ? notesId : undefined;

  function handleMouseEnter() {
    setHovered(true);
  }

  function handleMouseLeave() {
    setHovered(false);
    // Leaving the card returns to the front, however the back was reached.
    setFlipped(false);

    const pointerFocused = pointerFocusRef.current;
    if (pointerFocused && pointerFocused === document.activeElement) {
      pointerFocused.blur();
    }
    pointerFocusRef.current = null;
  }

  function handleFocus() {
    setFocused(true);
  }

  function handleBlur(event) {
    // Focus moving between the card, the dots and the ownership footer is
    // still "inside the card"; only leaving the cell returns to the front.
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    pointerFocusRef.current = null;
    setFocused(false);
    setFlipped(false);
  }

  // The shared flip control reports a toggle: a pointer click parks focus on
  // the card so the back stays until the pointer or focus leaves; a keyboard
  // activation keeps focus on the control so the face can be turned again.
  function handleFlipToggle(viaPointer) {
    if (!hasDistinctBack) {
      return;
    }

    setFlipped((current) => !current);

    if (!viaPointer) {
      return;
    }

    const cardButton = cardButtonRef.current;
    cardButton?.focus();
    pointerFocusRef.current = cardButton;
  }

  // Shift/Ctrl + ←/→ flips the focused card; the chord stops here so the
  // screen-level handler does not also move card focus. Plain arrows keep
  // moving focus as before.
  function handleKeyDown(event) {
    if (event.defaultPrevented) {
      return;
    }

    // A focused card hands Tab to its actions menu first; the menu then hands
    // it to Show back, so the photo control never precedes Item actions.
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      const menu = event.currentTarget.parentElement?.querySelector(
        ".showcase-item-menu-trigger",
      );

      if (menu) {
        event.preventDefault();
        menu.focus();
        return;
      }
    }

    const chord =
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      (event.shiftKey || event.ctrlKey) &&
      !event.metaKey &&
      !event.altKey;

    if (!chord || !hasDistinctBack) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setFlipped((current) => !current);
  }

  if (state === "unseen") {
    const openFinder = () => onOpenFinder?.(node);

    if (layout === "rail") {
      return (
        <div
          className="showcase-cell showcase-catalog-cell"
          data-showcase-node-id={node?.id}
        >
          <CatalogCardFrame
            describedBy={notesDescriptionId}
            label={`${label} is unseen. Replace with note`}
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
                {denomination ? (
                  <span className="showcase-catalog-denom">{denomination}</span>
                ) : null}
                {date ? <span className="showcase-catalog-date">{date}</span> : null}
                <ShowcaseCardNotes
                  id={notesDescriptionId}
                  layout="rail"
                  text={placeholderNotes}
                />
                {placeholderNotes ? null : (
                  <span className="showcase-catalog-empty">
                    No specimen recorded yet.
                  </span>
                )}
              </span>
            </span>
            <span className="showcase-catalog-add">Replace with note →</span>
          </CatalogCardFrame>
          {menu}
        </div>
      );
    }

    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
      >
        <CatalogCardFrame
          describedBy={notesDescriptionId}
          label={`${label} is unseen. Replace with note`}
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
          <ShowcaseCardNotes
            id={notesDescriptionId}
            text={placeholderNotes}
          />
          <span className="showcase-catalog-add">Replace with note →</span>
        </CatalogCardFrame>
        {menu}
      </div>
    );
  }

  const openBody = () => {
    if (entry) {
      onPresent?.(node);
      return;
    }

    onOpenNote?.(node, swapped ? "back" : "front");
  };
  const activationLabel = entry ? `Slideshow from ${label}` : label;

  if (layout === "rail") {
    return (
      <div
        className="showcase-cell showcase-catalog-cell"
        data-showcase-node-id={node?.id}
        onBlur={handleBlur}
        onFocus={handleFocus}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <CatalogCardFrame
          buttonRef={cardButtonRef}
          describedBy={notesDescriptionId}
          label={activationLabel}
          node={node}
          onClick={openBody}
          onKeyDown={handleKeyDown}
          pressed={swapped}
          state={state}
          toggleable={hasDistinctBack}
          variant="rail"
        >
          <span className="showcase-catalog-body">
            <CardPhoto
              backPath={backPath}
              image={image}
              label={label}
              onFlipToggle={handleFlipToggle}
              showFlip={flipVisible}
              swapped={swapped}
            />
            <span className="showcase-catalog-rail">
              <span className="showcase-catalog-railtop">{grip}</span>
              <span className="showcase-catalog-kicker">Catalog</span>
              {code ? <span className="showcase-catalog-code">{code}</span> : null}
              {denomination ? (
                <span className="showcase-catalog-denom">{denomination}</span>
              ) : null}
              {date ? <span className="showcase-catalog-date">{date}</span> : null}
              <ShowcaseCardNotes
                id={notesDescriptionId}
                layout="rail"
                text={notes}
              />
              <CatalogGrade grade={grade} layout="rail" />
            </span>
          </span>
        </CatalogCardFrame>
        {menu}
        <div className="showcase-card-footer">
          <SiblingChip
            count={node.sibling_count}
            node={node}
            onOpen={onOpenSiblings}
          />
          <StateLabel
            label={label}
            node={node}
            note={note}
            onToggleOwned={onToggleOwned}
            state={state}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="showcase-cell showcase-catalog-cell"
      data-showcase-node-id={node?.id}
      onBlur={handleBlur}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CatalogCardFrame
        buttonRef={cardButtonRef}
        describedBy={notesDescriptionId}
        label={activationLabel}
        node={node}
        onClick={openBody}
        onKeyDown={handleKeyDown}
        pressed={swapped}
        state={state}
        toggleable={hasDistinctBack}
        variant="labels"
      >
        <span className="showcase-catalog-topline">
          {grip}
          {code ? <span className="showcase-catalog-code">{code}</span> : null}
        </span>
        <CardPhoto
          backPath={backPath}
          image={image}
          label={label}
          onFlipToggle={handleFlipToggle}
          showFlip={flipVisible}
          swapped={swapped}
        />
        <span className="showcase-catalog-meta">
          <span className="showcase-catalog-line">{metaLine}</span>
          <CatalogGrade grade={grade} layout="labels" />
        </span>
        <ShowcaseCardNotes
          id={notesDescriptionId}
          text={notes}
        />
      </CatalogCardFrame>
      {menu}
      <div className="showcase-card-footer">
        <SiblingChip
          count={node.sibling_count}
          node={node}
          onOpen={onOpenSiblings}
        />
        <StateLabel
          label={label}
          node={node}
          note={note}
          onToggleOwned={onToggleOwned}
          state={state}
        />
      </div>
    </div>
  );
}

export { ShowcaseCatalogCard };
