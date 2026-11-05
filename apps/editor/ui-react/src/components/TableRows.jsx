import { useMemo, useRef, useState } from "react";
import { NoteRow } from "./NoteRow.jsx";

// The note rows, together with the drag-and-drop feedback that only ever
// concerns a row or two.
//
// Reorder feedback is row state: lifting a note and moving it over another row
// repaints those rows, not the table body. Keeping it here, below the header,
// the column widths and the virtualizer, is what stops a drag from rebuilding
// the whole table on every dragover. This component is the only writer of that
// state; the ref the screen hands down is a synchronous mirror of it, because
// the shell's edge auto-scroll has to know a drag is running without the table
// re-rendering. The shell listener stays on the shell: it is the only place
// that sees a drag over the sticky header, which is exactly where a drag pauses
// to scroll up.
export function TableRows({
  activeNoteId,
  canMove,
  canReorder,
  columns,
  dragStateRef,
  emptyContent,
  handlers,
  notes,
  onReorder,
  reorderRail,
  rowElementFor,
  rowModelsByNoteId,
  selectedIdSet,
  showGutter,
  topSpacerHeight,
  bottomSpacerHeight,
  totalColumnCount,
  virtualRows,
}) {
  const [drag, setDrag] = useState(() => dragStateRef.current);
  const dragPreviewRef = useRef(null);

  // The drag handlers have to keep their identity for the row memo boundary to
  // hold, so they read the latest props and drag state through refs instead of
  // closing over them.
  const latestPropsRef = useRef(null);
  latestPropsRef.current = { canReorder, onReorder, rowElementFor };

  const dragHandlers = useMemo(() => {
    function clearDragPreview() {
      if (dragPreviewRef.current) {
        dragPreviewRef.current.remove();
        dragPreviewRef.current = null;
      }
    }

    function setDragState(next) {
      dragStateRef.current = next;
      setDrag(next);
    }

    function clearDrag() {
      clearDragPreview();
      setDragState({ draggedNoteId: null, dropTarget: null });
    }

    function moveDropTarget(noteId, event) {
      const row = latestPropsRef.current.rowElementFor(noteId);

      if (!row) {
        return;
      }

      const bounds = row.getBoundingClientRect();
      const placement =
        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      const current = dragStateRef.current.dropTarget;

      if (current?.noteId === noteId && current?.placement === placement) {
        return;
      }

      setDragState({
        draggedNoteId: dragStateRef.current.draggedNoteId,
        dropTarget: { noteId, placement },
      });
    }

    function onDragStart(note, event) {
      const row = latestPropsRef.current.rowElementFor(note.id);

      clearDragPreview();
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(note.id));

      if (row) {
        // A cloned <tr> only lays out inside a table, and its <colgroup>
        // carries the column widths the real row was painted with. Wrap both
        // so the drag image keeps the row's geometry.
        const preview = document.createElement("table");
        const sourceColumns = row.closest("table")?.querySelector("colgroup");

        preview.classList.add("table-drag-preview");
        preview.setAttribute("aria-hidden", "true");
        preview.style.width = `${row.getBoundingClientRect().width}px`;

        if (sourceColumns) {
          preview.appendChild(sourceColumns.cloneNode(true));
        }

        preview.createTBody().appendChild(row.cloneNode(true));
        document.body.appendChild(preview);
        dragPreviewRef.current = preview;
        event.dataTransfer.setDragImage(preview, 24, 24);
      }

      setDragState({
        draggedNoteId: note.id,
        dropTarget: { noteId: note.id, placement: "before" },
      });
    }

    function onRowDragOver(note, event) {
      if (
        !latestPropsRef.current.canReorder ||
        dragStateRef.current.draggedNoteId === null
      ) {
        return;
      }

      event.preventDefault();
      moveDropTarget(note.id, event);
    }

    function onRowDragLeave(note, event) {
      // The drop placeholder is a sibling row inserted into this same tbody, so
      // moving the pointer onto it (or onto a neighbouring row) must not clear
      // the target. Clearing it would unmount the placeholder, drop the pointer
      // back on this row, and re-insert the placeholder — a loop that makes the
      // rows flicker. Only a move that leaves the body entirely clears it.
      const body = event.currentTarget.closest("tbody");

      if (event.relatedTarget && body?.contains(event.relatedTarget)) {
        return;
      }

      if (dragStateRef.current.dropTarget?.noteId !== note.id) {
        return;
      }

      setDragState({
        draggedNoteId: dragStateRef.current.draggedNoteId,
        dropTarget: null,
      });
    }

    function reorderOver(targetNoteId, placement) {
      const draggedNoteId = dragStateRef.current.draggedNoteId;

      clearDrag();
      void latestPropsRef.current.onReorder(
        draggedNoteId,
        targetNoteId,
        placement,
      );
    }

    function onRowDrop(note, event) {
      event.preventDefault();
      const { dropTarget } = dragStateRef.current;
      const nextPlacement =
        dropTarget?.noteId === note.id
          ? dropTarget.placement
          : event.clientY <
              event.currentTarget.getBoundingClientRect().top +
                event.currentTarget.getBoundingClientRect().height / 2
            ? "before"
            : "after";

      reorderOver(note.id, nextPlacement);
    }

    function onBodyDragOver(event) {
      if (
        !latestPropsRef.current.canReorder ||
        dragStateRef.current.draggedNoteId === null
      ) {
        return;
      }

      event.preventDefault();
    }

    function onBodyDrop(event) {
      const { draggedNoteId, dropTarget } = dragStateRef.current;

      // A row or the placeholder already handled this drop.
      if (
        event.defaultPrevented ||
        !latestPropsRef.current.canReorder ||
        draggedNoteId === null ||
        !dropTarget
      ) {
        return;
      }

      event.preventDefault();
      reorderOver(dropTarget.noteId, dropTarget.placement);
    }

    function onDragEnd() {
      clearDrag();
    }

    return {
      body: { onDragOver: onBodyDragOver, onDrop: onBodyDrop },
      row: {
        onDragEnd,
        onDragStart,
        onRowDragLeave,
        onRowDragOver,
        onRowDrop,
      },
    };
  }, [dragStateRef]);

  // Spreading the stable screen handlers keeps the object the rows receive
  // identical between commits that change nothing about the rows.
  const rowHandlers = useMemo(
    () => ({ ...handlers, ...dragHandlers.row }),
    [dragHandlers, handlers],
  );

  return (
    <tbody {...dragHandlers.body}>
      {topSpacerHeight ? (
        <tr aria-hidden="true" className="table-spacer-row">
          <td colSpan={totalColumnCount} style={{ height: topSpacerHeight }} />
        </tr>
      ) : null}
      {emptyContent}
      {virtualRows.map((virtualRow) => {
        const note = notes[virtualRow.index];

        return (
          <NoteRow
            canMove={canMove}
            canMoveDown={virtualRow.index < notes.length - 1}
            canMoveUp={virtualRow.index > 0}
            canReorder={canReorder}
            columns={columns}
            dropPlacement={
              drag.dropTarget?.noteId === note.id
                ? drag.dropTarget.placement
                : null
            }
            handlers={rowHandlers}
            index={virtualRow.index}
            isActive={activeNoteId === note.id}
            isDragging={drag.draggedNoteId === note.id}
            isSelected={selectedIdSet.has(note.id)}
            key={note.id}
            model={rowModelsByNoteId.get(note.id)}
            note={note}
            reorderRail={reorderRail}
            showGutter={showGutter}
            totalColumnCount={totalColumnCount}
          />
        );
      })}
      {bottomSpacerHeight ? (
        <tr aria-hidden="true" className="table-spacer-row">
          <td
            colSpan={totalColumnCount}
            style={{ height: bottomSpacerHeight }}
          />
        </tr>
      ) : null}
    </tbody>
  );
}
