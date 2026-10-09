import { PHOTO_SIZE_OPTIONS } from "../lib/photoSize.js";

// The card-width icon for each size: one frame outline that grows with the
// grid minimum (Small 200px / Medium 320px / Large 480px). The label text
// stays as the accessible name (screen-reader only + input aria-label) and
// the `title` gives sighted users the same word on hover.
const PHOTO_SIZE_ICON_WIDTHS = {
  small: 12,
  medium: 18,
  large: 24,
};

function PhotoSizeIcon({ value }) {
  const width = PHOTO_SIZE_ICON_WIDTHS[value] ?? 18;
  const height = 12;
  const x = (26 - width) / 2;
  const y = (16 - height) / 2;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      height="16"
      viewBox="0 0 26 16"
      width="26"
    >
      <rect
        fill="none"
        height={height}
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width={width}
        x={x}
        y={y}
      />
    </svg>
  );
}

// The three-way note photo size control (Small / Medium / Large). It is a native
// radio group so a keyboard or screen reader gets one-of-three semantics for
// free; the screen owns the remembered value and this stays presentational.
function ShowcasePhotoSizeControl({ onChange, value }) {
  return (
    <fieldset className="showcase-photo-size-control">
      <legend className="showcase-photo-size-legend">Photo size</legend>
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
            <PhotoSizeIcon value={option.value} />
            <span className="showcase-photo-size-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export { ShowcasePhotoSizeControl };
