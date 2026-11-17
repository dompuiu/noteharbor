import { useId } from "react";
import { PHOTO_SIZE_OPTIONS } from "../lib/photoSize.js";

// The three-way note photo size control (Small / Medium / Large). It is a
// labelled radio group so a keyboard or screen reader gets one-of-three
// semantics; the screen owns the remembered value and this stays
// presentational. The options print their initial as a compact letter in the
// pill (the prototype's S / M / L), while the full word stays as the
// accessible name and the hover `title`.
//
// A `div[role=group]` (not fieldset/legend) keeps the caption and the pill on
// one flex row so the pill centers with the toolbar's trailing controls — a
// legend always renders on its own row above the pill.
//
// Only Left/Right change the size (the radios' native behaviour); Up never
// changes it, and Down hands focus to the current level's cards through
// `onArrowDown` instead of moving the selection.
function ShowcasePhotoSizeControl({ onArrowDown, onChange, value }) {
  const labelId = useId();

  function handleKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onArrowDown?.();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
    }
  }

  return (
    <div
      aria-labelledby={labelId}
      className="showcase-photo-size-control"
      onKeyDown={handleKeyDown}
      role="group"
    >
      <span className="showcase-photo-size-legend" id={labelId}>
        Photo size
      </span>
      <div className="showcase-photo-size-options">
        {PHOTO_SIZE_OPTIONS.map((option) => (
          <label
            className="showcase-photo-size-option"
            key={option.value}
            title={option.label}
          >
            <input
              aria-label={option.label}
              checked={value === option.value}
              name="showcase-photo-size"
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <span aria-hidden="true" className="showcase-photo-size-letter">
              {option.letter}
            </span>
            <span className="showcase-photo-size-label">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export { ShowcasePhotoSizeControl };
