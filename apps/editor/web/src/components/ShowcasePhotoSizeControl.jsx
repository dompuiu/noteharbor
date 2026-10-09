import { PHOTO_SIZE_OPTIONS } from "../lib/photoSize.js";

// The three-way note photo size control (Small / Medium / Large). It is a native
// radio group so a keyboard or screen reader gets one-of-three semantics for
// free; the screen owns the remembered value and this stays presentational.
function ShowcasePhotoSizeControl({ onChange, value }) {
  return (
    <fieldset className="showcase-photo-size-control">
      <legend className="showcase-photo-size-legend">Photo size</legend>
      <div className="showcase-photo-size-options">
        {PHOTO_SIZE_OPTIONS.map((option) => (
          <label className="showcase-photo-size-option" key={option.value}>
            <input
              checked={value === option.value}
              name="showcase-photo-size"
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export { ShowcasePhotoSizeControl };
