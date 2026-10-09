import { minWidthForPhotoSize } from "../lib/photoSize.js";

// The shared card grid for a Showcase. It is presentation only: the photo size
// (Small / Medium / Large) arrives as a prop and sets the grid's minimum card
// width, and view and edit mode render the same grid so the canvas looks like
// the presentation. Ticket 12 reuses this for the read-only browse view.
function ShowcaseGrid({ children, className = "", size = "small" }) {
  return (
    <div
      className={`showcase-grid${className ? ` ${className}` : ""}`}
      data-testid="showcase-grid"
      style={{ "--showcase-card-min": `${minWidthForPhotoSize(size)}px` }}
    >
      {children}
    </div>
  );
}

export { ShowcaseGrid };
