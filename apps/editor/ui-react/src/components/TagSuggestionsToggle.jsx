// The chevron that says a tag field is a combobox. It leaves focus where it
// was so the field's own arrow-key handling keeps working after a click.
export function TagSuggestionsToggle({
  className = "",
  controlsId,
  expanded,
  onClick,
  strokeWidth = 2,
}) {
  return (
    <button
      aria-controls={expanded ? controlsId : undefined}
      aria-expanded={expanded}
      aria-haspopup="listbox"
      aria-label="Show tag suggestions"
      className={`tag-suggestions-toggle${expanded ? " is-open" : ""}${
        className ? ` ${className}` : ""
      }`}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      tabIndex={-1}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        focusable="false"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        viewBox="0 0 24 24"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
}
