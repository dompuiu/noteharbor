// The recessed "no specimen yet" well a catalog position shows before its first
// note: the unseen eyebrow, a faint banknote glyph, and the catalog identity.
// View mode's unseen card, the add-entry preview, and the edit-mode entry card
// all paint the same well so a planned position reads the same everywhere.
function ShowcaseCatalogWell({ identity }) {
  return (
    <span className="showcase-catalog-well">
      <span className="showcase-catalog-eyebrow">Unseen</span>
      <svg
        aria-hidden="true"
        className="showcase-catalog-glyph"
        focusable="false"
        viewBox="0 0 64 34"
      >
        <rect
          fill="none"
          height="31"
          rx="3"
          stroke="currentColor"
          strokeDasharray="3 3"
          strokeWidth="1.3"
          width="61"
          x="1.5"
          y="1.5"
        />
        <circle cx="32" cy="17" fill="none" r="8" stroke="currentColor" />
        <path
          d="M8 26c4-6 9-9 15-9M56 8c-4 6-9 9-15 9"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
      <span className="showcase-catalog-identity">{identity}</span>
    </span>
  );
}

export { ShowcaseCatalogWell };
