// The shared card grid for a Showcase. It is presentation only: the photo size
// CSS custom property (Small / Medium / Large) is set by the screen, and view
// and edit mode render the same grid so the canvas looks like the presentation.
// Ticket 12 reuses this for the read-only browse view.
function ShowcaseGrid({ children, className = "" }) {
  return (
    <div
      className={`showcase-grid${className ? ` ${className}` : ""}`}
      data-testid="showcase-grid"
    >
      {children}
    </div>
  );
}

export { ShowcaseGrid };
