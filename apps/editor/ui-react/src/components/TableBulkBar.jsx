import { useRef, useState } from "react";

// The selection actions bar. It sits at the bottom of the table and belongs to
// the row's tab cycle. It owns the progress of the bulk action it starts, so a
// running delete repaints the bar alone instead of committing the Table screen.
export function TableBulkBar({
  barRef,
  onClear,
  onDelete,
  onLeaveBackward,
  onLeaveForward,
  selectedCount,
}) {
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);

  async function handleDelete() {
    // The disabled button already blocks a second click, but the flag makes the
    // guard true for the rest of the current task too.
    if (workingRef.current) {
      return;
    }

    workingRef.current = true;
    setWorking(true);

    try {
      // The delete clears the selection when it finishes, which unmounts this
      // bar; the reset then lands on an unmounted component and is a no-op.
      await onDelete();
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  }

  function handleKeyDown(event) {
    if (event.key !== "Tab") {
      return;
    }

    const items = Array.from(
      barRef.current?.querySelectorAll("button:not([disabled])") ?? [],
    );

    if (!items.length) {
      return;
    }

    const atFirst = document.activeElement === items[0];
    const atLast = document.activeElement === items[items.length - 1];

    // The bar sits between a row and its controls in the tab cycle: forward
    // from the last control lands on the row's checkbox, backward from the
    // first one lands on the row's actions menu button.
    if (event.shiftKey && atFirst) {
      event.preventDefault();
      event.stopPropagation();
      onLeaveBackward();
      return;
    }

    if (!event.shiftKey && atLast) {
      event.preventDefault();
      event.stopPropagation();
      onLeaveForward();
    }
  }

  return (
    <div
      aria-label="Selection actions"
      className="table-bulk-bar"
      onKeyDown={handleKeyDown}
      ref={barRef}
      role="region"
    >
      <span className="table-bulk-bar-count">{selectedCount} selected</span>
      <span aria-hidden="true" className="table-bulk-bar-separator" />
      <button
        className="table-bulk-bar-delete"
        disabled={working}
        onClick={handleDelete}
        type="button"
      >
        {working ? "Working..." : "Delete"}
      </button>
      <button
        aria-label="Clear selection"
        className="table-bulk-bar-clear"
        onClick={onClear}
        title="Clear selection"
        type="button"
      >
        <svg
          aria-hidden="true"
          focusable="false"
          height="13"
          viewBox="0 0 24 24"
          width="13"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>
    </div>
  );
}
