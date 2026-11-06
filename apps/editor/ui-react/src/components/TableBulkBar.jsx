import { useId, useRef, useState } from "react";

// The selection actions bar. It sits at the bottom of the table and belongs to
// the row's tab cycle. It owns the progress of the bulk action it starts, so a
// running delete repaints the bar alone instead of committing the Table screen.
export function TableBulkBar({
  barRef,
  canMove = false,
  canMoveSelectionDown = false,
  canMoveSelectionUp = false,
  canReorder = false,
  onClear,
  onDelete,
  onLeaveBackward,
  onLeaveForward,
  onMove,
  onMoveSelectionDown,
  onMoveSelectionUp,
  onTags,
  selectedCount,
  selectionContiguous = false,
  saving = false,
  tagsButtonRef,
  tagsOpen = false,
  tagsSaving = false,
}) {
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const moveReasonId = useId();
  const moveUpReasonId = `${moveReasonId}-up`;
  const moveDownReasonId = `${moveReasonId}-down`;
  const selectedNoun = `${selectedCount} selected note${selectedCount === 1 ? "" : "s"}`;

  function moveReason(direction, canMove) {
    if (!selectionContiguous) {
      return "Select a continuous range to reorder";
    }

    if (saving) {
      return "Saving manual order…";
    }

    return canMove
      ? null
      : `The selection is already at the ${direction === "up" ? "top" : "bottom"}`;
  }

  const moveUpReason = moveReason("up", canMoveSelectionUp);
  const moveDownReason = moveReason("down", canMoveSelectionDown);
  const moveUpDisabled = working || moveUpReason != null;
  const moveDownDisabled = working || moveDownReason != null;

  async function handleDelete() {
    // The disabled button already blocks a second click, but the flag makes the
    // guard true for the rest of the current task too.
    if (workingRef.current) {
      return;
    }

    // A bulk delete asks before it acts, so progress can only start once the
    // collector answers: flipping the pill to "Working..." while the dialog is
    // still open reads as though the deletion already began.
    function reportWorkStarted() {
      workingRef.current = true;
      setWorking(true);
    }

    try {
      // The delete clears the selection when it finishes, which unmounts this
      // bar; the reset then lands on an unmounted component and is a no-op.
      await onDelete(reportWorkStarted);
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
      barRef.current?.querySelectorAll(
        "button:not([disabled]):not([tabindex='-1'])",
      ) ?? [],
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
      {canReorder ? (
        <>
          <button
            aria-describedby={moveUpReason ? moveUpReasonId : undefined}
            aria-disabled={moveUpDisabled || undefined}
            aria-label={`Move ${selectedNoun} up`}
            className="table-bulk-bar-move"
            onClick={moveUpDisabled ? undefined : onMoveSelectionUp}
            tabIndex={moveUpDisabled ? -1 : undefined}
            title={moveUpReason ?? `Move ${selectedNoun} up`}
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
                d="M12 19V5m0 0-6 6m6-6 6 6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          {moveUpReason ? (
            <span className="table-bulk-bar-note" id={moveUpReasonId}>
              {moveUpReason}
            </span>
          ) : null}
          <button
            aria-describedby={moveDownReason ? moveDownReasonId : undefined}
            aria-disabled={moveDownDisabled || undefined}
            aria-label={`Move ${selectedNoun} down`}
            className="table-bulk-bar-move"
            onClick={moveDownDisabled ? undefined : onMoveSelectionDown}
            tabIndex={moveDownDisabled ? -1 : undefined}
            title={moveDownReason ?? `Move ${selectedNoun} down`}
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
                d="M12 5v14m0 0-6-6m6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
          {moveDownReason ? (
            <span className="table-bulk-bar-note" id={moveDownReasonId}>
              {moveDownReason}
            </span>
          ) : null}
        </>
      ) : null}
      {canMove ? (
        <button
          disabled={working}
          onClick={onMove}
          type="button"
        >
          Move to…
        </button>
      ) : null}
      <button
        aria-controls={tagsOpen ? "bulk-tag-panel" : undefined}
        aria-expanded={tagsOpen}
        aria-haspopup="dialog"
        className="table-bulk-bar-tags"
        disabled={working || tagsSaving}
        onClick={onTags}
        ref={tagsButtonRef}
        type="button"
      >
        Tags…
      </button>
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
