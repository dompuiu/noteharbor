// The drawn cross shared by the table filter chips and the note editor's tag
// chips. The SVG beats the × glyph because it centres exactly in the 17px hit
// box (the glyph sits on the font's math axis).
export function ChipRemoveButton({ label, onClick, title }) {
  return (
    <button
      aria-label={label}
      className="table-filter-chip-remove"
      onClick={onClick}
      title={title}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
        viewBox="0 0 12 12"
      >
        <path d="m2.5 2.5 7 7M9.5 2.5l-7 7" />
      </svg>
    </button>
  );
}
