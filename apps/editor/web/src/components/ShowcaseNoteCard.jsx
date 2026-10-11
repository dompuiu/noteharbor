import { useEffect, useId, useRef, useState } from "react";
import { firstAvailableNoteImage, pickNoteImage } from "../lib/showcaseImages.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";

// The read-only Note card (presentation spec §3, §8). The front image is the
// default; if there is no front it falls back to the back, else a muted
// "No image". In view mode a hover or a focus transiently previews the back
// when a distinct one exists (the two faces cross-fade); edit mode never
// swaps. The card is a button and never a link: activating (click / Enter /
// Space) never changes the image and never opens the Note slideshow.
function pickBackImage(note) {
  return (
    pickNoteImage(note, "back", "thumbnail") ||
    pickNoteImage(note, "back", "full")
  );
}

function ShowcaseNoteCard({ note, mode = "view", pressed = false, nodeId, onOpen }) {
  const editMode = mode === "edit";
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // The info tooltip opens on icon hover or pins with the `i` key on a
  // keyboard-focused card. The icon is a plain span (never a nested button)
  // since the card itself is the button.
  const [infoHovered, setInfoHovered] = useState(false);
  const [infoPinned, setInfoPinned] = useState(false);
  const tooltipId = useId();
  // Leaving the icon starts a short close delay instead of hiding at once,
  // so the cursor can travel onto the tooltip itself without a flicker.
  // Entering either end cancels the pending close.
  const infoCloseTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (infoCloseTimeoutRef.current) {
        clearTimeout(infoCloseTimeoutRef.current);
      }
    };
  }, []);

  const primary = firstAvailableNoteImage(note);
  const back = pickBackImage(note);
  // The swap needs a distinct back; a back-only note shows the back as its sole
  // image and never swaps (presentation spec §9).
  const hasDistinctBack = primary?.type === "front" && Boolean(back);
  const revealed = hovered || focused;
  const active = pressed || revealed;
  const swapped = !editMode && hasDistinctBack && active;
  const soleBack = primary?.type === "back";
  const frontPath = primary?.type === "front" ? primary.path : null;
  const backPath = back || null;
  // Only the shown face is exposed to assistive tech; the other is hidden and
  // carries an empty alt so it is not a second image in the accessibility tree.
  const frontVisible = Boolean(frontPath) && !swapped && !soleBack;
  const backVisible = Boolean(backPath) && (swapped || soleBack);
  const parts = showcaseNoteDisplayParts(note);
  const caption = parts.join(" · ");
  const label = parts.join(", ");
  const backLabel = label ? `${label} (back)` : "back";
  const description = String(note?.notes ?? "").trim();
  const tagNames = (Array.isArray(note?.tags) ? note.tags : [])
    .map((tag) => (typeof tag === "string" ? tag.trim() : String(tag?.name ?? "").trim()))
    .filter(Boolean);
  // No description and no tags means no icon and no tooltip at all.
  const hasDetails = Boolean(description) || tagNames.length > 0;
  const tooltipOpen = hasDetails && (infoHovered || infoPinned);

  function handleClick(event) {
    // A mouse click parks focus on the card, and focus alone previews the
    // back — without this the back would stick after the pointer leaves, and
    // clicking a second card would just move the stuck preview there.
    // `detail` is the click count for a real pointer click and 0 for a
    // keyboard-activated one, so keyboard focus (Tab / Enter / Space) keeps
    // working while a mouse click never holds the preview.
    if (!editMode && event.detail > 0) {
      event.currentTarget.blur();
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
    }

    setInfoPinned(false);
  }

  function handleInfoMouseEnter() {
    if (infoCloseTimeoutRef.current) {
      clearTimeout(infoCloseTimeoutRef.current);
      infoCloseTimeoutRef.current = null;
    }

    setInfoHovered(true);
  }

  function handleInfoMouseLeave() {
    if (infoCloseTimeoutRef.current) {
      clearTimeout(infoCloseTimeoutRef.current);
    }

    infoCloseTimeoutRef.current = setTimeout(() => {
      setInfoHovered(false);
    }, 150);
  }

  // `i` pins the info tooltip on the focused card; a second `i` (or Escape)
  // dismisses it. Escape stops here so the screen-level handler does not blur
  // the card underneath the dismissed tooltip. Without details there is no
  // tooltip, so `i` does nothing.
  function handleKeyDown(event) {
    if (event.key === "i" || event.key === "I") {
      if (hasDetails) {
        setInfoPinned((current) => !current);
      }
      return;
    }

    if (event.key === "Escape" && infoPinned) {
      event.preventDefault();
      event.stopPropagation();
      setInfoPinned(false);
    }
  }

  return (
    <button
      aria-describedby={tooltipOpen ? tooltipId : undefined}
      aria-label={label}
      aria-pressed={swapped}
      className={`showcase-card showcase-card--note${swapped ? " showcase-card--back" : ""}`}
      data-showcase-node-id={nodeId}
      onBlur={handleBlur}
      onClick={handleClick}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
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
      <span className="showcase-card-caption-row">
        <span className="showcase-card-caption">{caption}</span>
        {hasDetails ? (
          <span
            aria-hidden="true"
            className="showcase-card-info"
            onMouseEnter={handleInfoMouseEnter}
            onMouseLeave={handleInfoMouseLeave}
          >
            <svg
              aria-hidden="true"
              className="showcase-card-info-icon"
              focusable="false"
              height="14"
              viewBox="0 0 24 24"
              width="14"
            >
              <circle
                cx="12"
                cy="12"
                fill="none"
                r="9"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M12 11v5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
              <circle cx="12" cy="8" fill="currentColor" r="1.2" />
            </svg>
          </span>
        ) : null}
        {tooltipOpen ? (
          <span
            className="showcase-card-tooltip"
            id={tooltipId}
            onMouseEnter={handleInfoMouseEnter}
            onMouseLeave={handleInfoMouseLeave}
            role="tooltip"
          >
            {description ? (
              <span className="showcase-card-tooltip-description">
                {description}
              </span>
            ) : null}
            {tagNames.length ? (
              <span className="showcase-card-tooltip-tags">
                {tagNames.map((name, index) => (
                  <span className="tag" key={`${name}-${index}`}>
                    {name}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export { ShowcaseNoteCard };
