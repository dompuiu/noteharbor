import { minWidthForPhotoSize, normalizePhotoSize } from "../lib/photoSize.js";

// The shared card grid for a Showcase. It is presentation only: the photo size
// (Small / Medium / Large) arrives as a prop and sets the grid's minimum card
// width, and view and edit mode render the same grid so the canvas looks like
// the presentation. Ticket 12 reuses this for the read-only browse view. The
// size is also exposed as `data-photo-size`, so a narrow card can tighten its
// own chrome without JavaScript reading the size again.
function ShowcaseGrid({ children, className = "", size = "small" }) {
  return (
    <div
      className={`showcase-grid${className ? ` ${className}` : ""}`}
      data-photo-size={normalizePhotoSize(size)}
      data-testid="showcase-grid"
      style={{ "--showcase-card-min": `${minWidthForPhotoSize(size)}px` }}
    >
      {children}
    </div>
  );
}

export { ShowcaseGrid };
