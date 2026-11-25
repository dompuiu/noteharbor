// The rail's one create action. The Table screen and the All notes screen
// both offer it, so the label, icon and advertised shortcut stay one thing.
export function AddNoteButton({ disabled = false, onClick, shortcut = "a" }) {
  return (
    <button
      aria-label="Add note"
      className="button button-primary"
      data-shortcut={shortcut ?? undefined}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <svg
        aria-hidden="true"
        fill="none"
        focusable="false"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="15"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
      <span className="table-rail-button-label">Add note</span>
    </button>
  );
}
