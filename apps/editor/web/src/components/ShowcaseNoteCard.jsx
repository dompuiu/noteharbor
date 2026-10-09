import { useState } from "react";
import { firstAvailableNoteImage, pickNoteImage } from "../lib/showcaseImages.js";

// The read-only Note card (presentation spec §3, §8). The front image is the
// default; if there is no front it falls back to the back, else a muted
// "No image". In view mode a hover, a focus, or a tap reveals the back when a
// distinct one exists (the two faces cross-fade); edit mode never swaps. The
// card is a button and never a link: activating it toggles the side, it never
// opens the Note slideshow.
function pickBackImage(note) {
  return (
    pickNoteImage(note, "back", "thumbnail") ||
    pickNoteImage(note, "back", "full")
  );
}

function ShowcaseNoteCard({ note, mode = "view", pressed = false, onOpen }) {
  const editMode = mode === "edit";
  // `flipped` is the explicit front/back choice (a tap or Enter/Space); until
  // it is set the card follows the transient hover/focus reveal.
  const [flipped, setFlipped] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const primary = firstAvailableNoteImage(note);
  const back = pickBackImage(note);
  // The swap needs a distinct back; a back-only note shows the back as its sole
  // image and never swaps (presentation spec §9).
  const hasDistinctBack = primary?.type === "front" && Boolean(back);
  const revealed = hovered || focused;
  const active = pressed || (flipped !== null ? flipped : revealed);
  const swapped = !editMode && hasDistinctBack && active;
  const soleBack = primary?.type === "back";
  const frontPath = primary?.type === "front" ? primary.path : null;
  const backPath = back || null;
  // Only the shown face is exposed to assistive tech; the other is hidden and
  // carries an empty alt so it is not a second image in the accessibility tree.
  const frontVisible = Boolean(frontPath) && !swapped && !soleBack;
  const backVisible = Boolean(backPath) && (swapped || soleBack);
  const denomination = String(note?.denomination ?? "").trim();
  const issueDate = String(note?.issue_date ?? "").trim();
  const caption = [denomination, issueDate].filter(Boolean).join(" · ");
  const label = [denomination, issueDate].filter(Boolean).join(", ");
  const backLabel = label ? `${label} (back)` : "back";

  function handleClick(event) {
    if (!editMode && hasDistinctBack) {
      setFlipped((current) => !(current === true));
    }

    onOpen?.(event);
  }

  function handleMouseEnter() {
    if (!editMode) {
      setHovered(true);
    }
  }

  function handleMouseLeave() {
    if (!editMode) {
      setHovered(false);
      setFlipped(null);
    }
  }

  function handleFocus() {
    if (!editMode) {
      setFocused(true);
    }
  }

  function handleBlur() {
    if (!editMode) {
      setFocused(false);
      setFlipped(null);
    }
  }

  return (
    <button
      aria-label={label}
      aria-pressed={swapped}
      className={`showcase-card showcase-card--note${swapped ? " showcase-card--back" : ""}`}
      onBlur={handleBlur}
      onClick={handleClick}
      onFocus={handleFocus}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      type="button"
    >
      <span className="showcase-card-image">
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
        {!frontPath && !backPath ? (
          <span className="showcase-card-no-image">No image</span>
        ) : null}
      </span>
      <span className="showcase-card-caption">{caption}</span>
    </button>
  );
}

export { ShowcaseNoteCard };
