import { useId } from "react";
import { CATALOG_LAYOUT_OPTIONS } from "../lib/catalogLayout.js";

// The two-way catalog card layout control. It is a labelled radio group so a
// keyboard or screen reader gets one-of-two semantics; the screen owns the
// remembered value and this stays presentational. Each option prints a small
// card diagram: caption-over-photo for the Library label, photo-beside-rail
// for the Auction rail. The full name stays as the accessible name and the
// hover `title`.
//
// A `div[role=group]` (not fieldset/legend) keeps the legend out of the flow,
// exactly like the photo-size pill beside it.
function LayoutIcon({ name }) {
  if (name === "rail") {
    return (
      <svg
        aria-hidden="true"
        className="showcase-layout-icon"
        focusable="false"
        height="16"
        viewBox="0 0 20 20"
        width="16"
      >
        <rect
          fill="none"
          height="15"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.4"
          width="15"
          x="2.5"
          y="2.5"
        />
        <rect
          fill="none"
          height="9"
          rx="1"
          stroke="currentColor"
          strokeWidth="1.4"
          width="5.5"
          x="5"
          y="5.5"
        />
        <path
          d="M12.8 6.6h2.2M12.8 9.8h2.2M12.8 13h2.2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.4"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="showcase-layout-icon"
      focusable="false"
      height="16"
      viewBox="0 0 20 20"
      width="16"
    >
      <rect
        fill="none"
        height="15"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
        width="15"
        x="2.5"
        y="2.5"
      />
      <rect
        fill="none"
        height="5.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.4"
        width="9"
        x="5.5"
        y="5"
      />
      <path
        d="M5.5 13.4h6M5.5 15.6h4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

function ShowcaseLayoutControl({ onArrowDown, onChange, value }) {
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
      className="showcase-layout-control"
      onKeyDown={handleKeyDown}
      role="group"
    >
      <span className="showcase-layout-legend" id={labelId}>
        Card layout
      </span>
      <div className="showcase-layout-options">
        {CATALOG_LAYOUT_OPTIONS.map((option) => (
          <label
            className="showcase-layout-option"
            key={option.value}
            title={option.label}
          >
            <input
              aria-label={option.label}
              checked={value === option.value}
              name="showcase-catalog-layout"
              onChange={() => onChange(option.value)}
              type="radio"
              value={option.value}
            />
            <LayoutIcon name={option.icon} />
            <span className="showcase-layout-label">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export { ShowcaseLayoutControl };
