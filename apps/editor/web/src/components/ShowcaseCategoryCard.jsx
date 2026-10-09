// A Category has no cover image: its card is name-only (presentation spec §3).
// The card is the shared read-only presentation of a Category Placement; the
// edit controls live beside it, not inside it, so ticket 12 can render this
// alone.
function ShowcaseCategoryCard({ name, onOpen }) {
  return (
    <button
      aria-label={`Open category ${name}`}
      className="showcase-card showcase-card--category"
      onClick={onOpen}
      type="button"
    >
      <span className="showcase-card-name">{name}</span>
    </button>
  );
}

export { ShowcaseCategoryCard };
