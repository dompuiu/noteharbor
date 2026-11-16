import { normalizeCatalogLayout } from "../lib/catalogLayout.js";
import { minWidthForPhotoSize, normalizePhotoSize } from "../lib/photoSize.js";

// The shared card grid for a Showcase. It is presentation only: the photo size
// (Small / Medium / Large) arrives as a prop and sets the grid's minimum card
// width, and view and edit mode render the same grid so the canvas looks like
// the presentation. Ticket 12 reuses this for the read-only browse view. The
// size is also exposed as `data-photo-size`, so a narrow card can tighten its
// own chrome without JavaScript reading the size again.
//
// A catalog Showcase also passes `catalogLayout`. It is exposed as
// `data-catalog-layout`, so the card chrome and the rail's column counts can
// respond without reading the preference again. Presentation-only showcases
// leave it null and keep the plain photo-size grid.
function ShowcaseGrid({
  catalogLayout = null,
  children,
  className = "",
  size = "small",
}) {
  const layout = catalogLayout ? normalizeCatalogLayout(catalogLayout) : null;
  const minWidth = minWidthForPhotoSize(size);

  return (
    <div
      className={`showcase-grid${className ? ` ${className}` : ""}`}
      data-catalog-layout={layout ?? undefined}
      data-photo-size={normalizePhotoSize(size)}
      data-testid="showcase-grid"
      style={{ "--showcase-card-min": `${minWidth}px` }}
    >
      {children}
    </div>
  );
}

export { ShowcaseGrid };
