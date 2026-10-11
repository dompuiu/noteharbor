import { useEffect, useId, useRef, useState } from "react";
import { firstAvailableNoteImage, pickNoteImage } from "../lib/showcaseImages.js";
import { showcaseNoteDisplayParts } from "../lib/showcaseNoteLabels.js";

// The read-only Note card (presentation spec §3, §8). The front image is the
// default; if there is no front it falls back to the back, else a muted
// "No image". In view mode the back is never a hover preview: hovering or
// focusing a card with a distinct back reveals a flip control in the image's
// bottom-right corner, and clicking it (or pressing Shift/Ctrl + ←/→ on the
// focused card) toggles to the back. Moving the pointer out, or blurring the
// card, always returns to the front. Edit mode never flips. The card is a button and never a link:
// activating (click / Enter / Space on the card itself) never changes the
// image and never opens the Note slideshow.
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
  // The explicit flip: clicking the flip control (or the Shift/Ctrl + ←/→
  // chord below) toggles to the back. Hover/focus alone never flips; they
  // only reveal the control. Blur, or moving the pointer out, returns to the
  // front.
  // The info tooltip opens on icon hover or pins with the `i` key on a
  // keyboard-focused card. The icon is a plain span (never a nested button)
  // since the card itself is the button.
  const [infoHovered, setInfoHovered] = useState(false);
  const [infoPinned, setInfoPinned] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const cardRef = useRef(null);
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
  // The flip needs a distinct back; a back-only note shows the back as its sole
  // image and never flips (presentation spec §9).
  const hasDistinctBack = primary?.type === "front" && Boolean(back);
  const swapped = !editMode && hasDistinctBack && (pressed || flipped);
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
  // The flip control only exists on notes with a distinct back, and only
  // surfaces on hover/focus (or while flipped, so it can be flipped back).
  const flipVisible =
    !editMode && hasDistinctBack && (hovered || focused || flipped);

  function handleClick(event) {
    // A mouse click parks focus on the card, and focus alone used to preview
    // the back — without this the preview would stick after the pointer
    // leaves, and clicking a second card would just move the stuck preview
    // there. Hover/focus no longer flip, but the blur keeps a tap neutral:
    // the front stays showing and no focus ring is left behind.
    // `detail` is the click count for a real pointer click and 0 for a
    // keyboard-activated one, so keyboard focus (Tab / Enter / Space) keeps
    // working while a mouse click never holds focus.
    if (!editMode && event.detail > 0) {
      event.currentTarget.blur();
    }

    onOpen?.(event);
  }

  // The flip control is a plain span (never a nested button) since the card
  // itself is the button — same as the info icon. It stops the click so the
  // card's own tap handler never runs, then parks focus on the card so the
  // back stays until focus leaves (blur resets it below).
  function handleFlipClick(event) {
    event.preventDefault();
    event.stopPropagation();

    if (editMode || !hasDistinctBack) {
      return;
    }

    setFlipped((current) => !current);
    cardRef.current?.focus();
  }

  function handleMouseEnter() {
    if (!editMode) {
      setHovered(true);
    }
  }

  function handleMouseLeave() {
    if (!editMode) {
      setHovered(false);
      // Moving the pointer out returns to the front, however the back was
      // reached — same as leaving focus below.
      setFlipped(false);
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
      // Leaving the note returns to the front, however the back was reached.
      setFlipped(false);
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
  // Shift/Ctrl + ←/→ toggles the back on a focused card with a distinct one.
  // The chord stops here so the screen-level handler does not also move card
  // focus; plain arrows keep moving focus as before.
  function handleKeyDown(event) {
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      (event.shiftKey || event.ctrlKey) &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (!editMode && hasDistinctBack) {
        event.preventDefault();
        event.stopPropagation();
        setFlipped((current) => !current);
      }
      return;
    }

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
      data-has-back={hasDistinctBack ? "true" : undefined}
      data-showcase-node-id={nodeId}
      onBlur={handleBlur}
      onClick={handleClick}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      ref={cardRef}
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
        {flipVisible ? (
          <span
            aria-hidden="true"
            className="showcase-card-flip"
            onClick={handleFlipClick}
            title={swapped ? "Show front" : "Show back"}
          >
            <svg
              aria-hidden="true"
              className="showcase-card-flip-icon"
              focusable="false"
              height="14"
              viewBox="0 0 24 24"
              width="14"
            >
              <path
                d="M7 8h10l-3-3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
              <path
                d="M17 16H7l3 3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </span>
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
              <span className="showcase-card-tooltip-row">
                <strong>Description:</strong>{" "}
                <span className="showcase-card-tooltip-description">
                  {description}
                </span>
              </span>
            ) : null}
            {tagNames.length ? (
              <span className="showcase-card-tooltip-row">
                <strong>Tags:</strong>
                <span className="showcase-card-tooltip-tags">
                  {tagNames.map((name, index) => (
                    <span className="tag" key={`${name}-${index}`}>
                      {name}
                    </span>
                  ))}
                </span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export { ShowcaseNoteCard };
