import { useId } from "react";

// The Table screen's transient find bar. It floats over the current view so
// opening it never reflows the rows, and it only ever moves a cursor over the
// list — filters, sort, selection and the URL stay exactly where they were.
export function TableFindBar({
  canSearchAll,
  currentIndex,
  filtersActive,
  inputRef,
  matchCount,
  onClose,
  onQueryChange,
  onSearchAll,
  onStep,
  pending,
  query,
}) {
  const countId = useId();
  const trimmedQuery = query.trim();
  const singleMatch = pending || matchCount < 2;

  let countText = "Type to find";

  if (trimmedQuery) {
    if (pending) {
      countText = "Searching…";
    } else if (matchCount > 0) {
      countText = `${currentIndex + 1} of ${matchCount}`;
    } else {
      countText = filtersActive
        ? "No matches in this view"
        : "No notes match";
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      onStep(event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      // The table's own Escape order starts with closing find, so stop the
      // press here rather than letting the window handler run it twice.
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      aria-label="Find in this view"
      className="table-find-bar"
      role="search"
    >
      <svg
        aria-hidden="true"
        className="table-find-icon"
        fill="none"
        focusable="false"
        height="15"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.9"
        viewBox="0 0 24 24"
        width="15"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        aria-describedby={countId}
        aria-label="Find notes in this view"
        autoComplete="off"
        className="table-find-input"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in this view…"
        ref={inputRef}
        type="search"
        value={query}
      />
      <span className="table-find-count" id={countId}>
        {countText}
      </span>
      {trimmedQuery && !pending && !matchCount && canSearchAll ? (
        <button
          className="table-find-all"
          onClick={onSearchAll}
          type="button"
        >
          Search all notes
        </button>
      ) : null}
      <span className="table-find-actions">
        <button
          aria-label="Previous match"
          className="table-find-button"
          disabled={singleMatch}
          onClick={() => onStep(-1)}
          title="Previous match (Shift+Enter)"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
        <button
          aria-label="Next match"
          className="table-find-button"
          disabled={singleMatch}
          onClick={() => onStep(1)}
          title="Next match (Enter)"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button
          aria-label="Close find"
          className="table-find-button"
          onClick={onClose}
          title="Close find (Esc)"
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </span>
    </div>
  );
}
