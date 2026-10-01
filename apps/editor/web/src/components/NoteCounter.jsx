import { useEffect, useRef, useState } from "react";

// The previous/next arrows plus the position counter, shared by the Note
// editor and the Note slideshow. It is deliberately dumb about routing: the
// caller passes the position, the total, the labels, and what should happen
// when a control is used. The first number can be typed into to jump, which
// is the only state the component keeps: whether the value is being edited,
// and the digits typed so far.
function clampPosition(value, total) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(Math.max(value, 1), total);
}

function NoteCounter({
  addMode = false,
  canGoNext = true,
  canGoPrevious = true,
  counterTitle,
  jumpLabel = "Note position",
  nextLabel = "Edit next note",
  onJump,
  onNext,
  onPrevious,
  position = null,
  previousLabel = "Edit previous note",
  showArrows = true,
  total = 0,
  variant = "light",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const editable = typeof onJump === "function" && total > 0;
  const showArrowControls = showArrows && total > 0;
  const currentPosition = addMode
    ? "?"
    : position == null
      ? "-"
      : String(position);

  useEffect(() => {
    if (!editing) {
      return;
    }

    inputRef.current?.focus();
  }, [editing]);

  function beginEdit() {
    if (!editable || editing) {
      return;
    }

    setDraft("");
    setEditing(true);
  }

  function commitJump() {
    const parsedValue = Number.parseInt(draft, 10);
    setEditing(false);

    if (!Number.isFinite(parsedValue)) {
      return;
    }

    onJump?.(clampPosition(parsedValue, total));
  }

  function handleInputKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitJump();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      return;
    }

    // While the number has focus the arrows move the caret instead of
    // navigating; keep the key away from the screen-level handlers.
    if (
      event.key.startsWith("Arrow") ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.stopPropagation();
    }
  }

  const rootClassName =
    variant === "dark"
      ? "counter-pill note-counter note-counter--dark"
      : `note-nav-group note-counter${addMode ? " note-counter--add" : ""}`;
  const valueClassName = [
    variant === "light" ? "note-nav-counter" : null,
    "note-counter-value",
    addMode ? "note-counter-value--add" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const editableProps =
    editable && !editing
      ? {
          "aria-label": jumpLabel,
          className: `${valueClassName} note-counter-value--editable`,
          onClick: beginEdit,
          onFocus: beginEdit,
          role: "textbox",
          tabIndex: 0,
        }
      : { className: valueClassName };

  return (
    <div className={rootClassName}>
      {showArrowControls ? (
        <button
          aria-label={previousLabel}
          className="icon-link note-nav-arrow"
          disabled={!canGoPrevious}
          onClick={onPrevious}
          title="Previous note (← or h)"
          type="button"
        >
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            <path
              d="M15 6l-6 6 6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      ) : null}
      <span title={counterTitle} {...editableProps}>
        {editing ? (
          <input
            aria-label={jumpLabel}
            className="note-counter-input"
            data-note-counter-input="true"
            inputMode="numeric"
            onBlur={() => setEditing(false)}
            onChange={(event) => setDraft(event.target.value.replace(/\D/g, ""))}
            onKeyDown={handleInputKeyDown}
            placeholder={currentPosition}
            ref={inputRef}
            value={draft}
          />
        ) : (
          currentPosition
        )}
        {` / ${total}`}
      </span>
      {showArrowControls ? (
        <button
          aria-label={nextLabel}
          className="icon-link note-nav-arrow"
          disabled={!canGoNext}
          onClick={onNext}
          title="Next note (→ or l)"
          type="button"
        >
          <svg aria-hidden="true" height="16" viewBox="0 0 24 24" width="16">
            <path
              d="M9 6l6 6-6 6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

export { NoteCounter };
