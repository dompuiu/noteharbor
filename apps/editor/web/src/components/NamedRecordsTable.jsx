import { Fragment, useEffect, useRef, useState } from "react";
import { useConfirmation } from "./ConfirmDialog.jsx";
import { isEditableElement } from "../lib/editableElement.js";

// The banknote table's page keys land on the first row of the next screenful.
// A records table is short enough not to need virtualization, so paging is a
// plain offset of one viewport of rows; this is the fallback when the viewport
// cannot be measured (notably jsdom).
const PAGE_FALLBACK_ROWS = 10;

// A table of named records: one row per record, a name field, and a default
// flag. Each row carries a default star and rename / delete actions. The
// component owns the keyboard cursor and in-place editing, and reports every
// change through callbacks so the caller keeps owning the record list. Its
// keyboard model mirrors the banknote table — a window-level cursor with
// ↑/↓/j/k, Home/End, PgUp/PgDn, `a` to add, `e` to rename, `d` to delete,
// Enter/Space to edit, and Escape to drop the cursor to the table anchor. It
// is deliberately free of any domain coupling — Categories and Groupings can
// pass their own records and verbs.
function NamedRecordsTable({
  ariaLabel = "Named records",
  emptyText = "No records yet.",
  extraColumns = [],
  itemLabel = "record",
  itemLabelPlural = "records",
  loading = false,
  onCreate,
  onDelete,
  onReorder,
  onSetDefault,
  onUpdate,
  records,
}) {
  const anchorRef = useRef(null);
  const addButtonRef = useRef(null);
  const addInputRef = useRef(null);
  const rowRefs = useRef(new Map());
  const tableWrapRef = useRef(null);
  // The cursor id lives in a ref as well as state: the global key handler
  // reads it without re-subscribing on every keystroke, and a mouse press
  // (which must not paint the highlight) still records where the keyboard
  // would resume.
  const focusedIdRef = useRef(null);
  // The id of the row being edited, reachable from handlers without rebuilding
  // their closures on every keystroke.
  const editingIdRef = useRef(null);
  // True between a row's mousedown and mouseup, so clicking a row focuses it
  // without claiming the keyboard cursor highlight.
  const mouseFocusSuppressRef = useRef(false);
  // The floating clone shown under the pointer while a row is dragged.
  const dragPreviewRef = useRef(null);

  const [focusedId, setFocusedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draggedId, setDraggedId] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();
  // A focus intent that has to wait for `records` to reflect the change that
  // produced it (a created row, a deleted row's neighbour). A missing row
  // means "not yet", not "give up", so the request survives until it lands.
  const [focusRequest, setFocusRequest] = useState(null);

  const canReorder = Boolean(onReorder);
  const totalColumnCount =
    (canReorder ? 1 : 0) + 2 + extraColumns.length + 1;

  editingIdRef.current = editingId;

  useEffect(() => {
    if (isAdding) {
      addInputRef.current?.focus();
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingId == null) {
      return;
    }

    const input = rowRefs.current
      .get(editingId)
      ?.querySelector(".named-records-name-input");
    input?.focus();
    input?.select();
  }, [editingId]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    if (focusRequest.add) {
      setFocusRequest(null);
      addButtonRef.current?.focus();
      return;
    }

    if (focusRequest.anchor) {
      setFocusRequest(null);
      anchorRef.current?.focus();
      return;
    }

    const element = rowRefs.current.get(focusRequest.id);

    if (!element) {
      return;
    }

    setFocusRequest(null);
    element.focus();
  }, [focusRequest, records]);

  // Release the mouse-press latch even when the release happens outside the
  // row (or outside the window) — otherwise the next focus would silently
  // skip painting the cursor once.
  useEffect(() => {
    function releaseMouseFocusSuppression() {
      mouseFocusSuppressRef.current = false;
    }

    window.addEventListener("mouseup", releaseMouseFocusSuppression);
    return () =>
      window.removeEventListener("mouseup", releaseMouseFocusSuppression);
  }, []);

  function focusRow(id) {
    const element = rowRefs.current.get(id);

    if (element) {
      element.focus();
      focusedIdRef.current = id;
      setFocusedId(id);
    }
  }

  function clearCursor() {
    focusedIdRef.current = null;
    setFocusedId(null);
  }

  function moveFocus(offset) {
    if (!records.length) {
      return;
    }

    const currentIndex = records.findIndex(
      (record) => record.id === focusedIdRef.current,
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      records.length - 1,
    );

    focusRow(records[nextIndex].id);
  }

  // PgUp/PgDn move one viewport of rows. The viewport is the scroll region
  // minus its (sticky) header, measured in rows; when it cannot be measured
  // (jsdom reports a zero-height box) a fixed page keeps the keys useful.
  function pageFocus(direction) {
    if (!records.length) {
      return;
    }

    const wrap = tableWrapRef.current;
    const headerHeight =
      wrap?.querySelector("thead")?.offsetHeight ?? 0;
    const rowHeight =
      wrap?.querySelector("tbody tr.named-record-row")?.offsetHeight || 43;
    const viewport = (wrap?.clientHeight ?? 0) - headerHeight;
    const pageSize =
      viewport > 0
        ? Math.max(1, Math.floor(viewport / rowHeight))
        : PAGE_FALLBACK_ROWS;

    moveFocus(direction * pageSize);
  }

  function clearDragPreview() {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  }

  function clearDragState() {
    clearDragPreview();
    setDraggedId(null);
    setDropTarget(null);
    // A drag can end without a mouseup over the row, so release the
    // press-suppresses-highlight latch here too.
    mouseFocusSuppressRef.current = false;
  }

  function updateDropTarget(recordId, event) {
    const row = rowRefs.current.get(recordId);

    if (!row) {
      return;
    }

    const bounds = row.getBoundingClientRect();
    const placement =
      event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";

    setDropTarget((current) =>
      current?.recordId === recordId && current?.placement === placement
        ? current
        : { recordId, placement },
    );
  }

  // Commit a drop by handing the new id order to the caller. The caller owns
  // the record list, so the table never reorders its own copy; the row keeps
  // its key and React moves the same DOM node (and its focus) to the new slot.
  async function handleReorder(targetRecordId, placement) {
    if (!canReorder || draggedId == null) {
      clearDragState();
      return;
    }

    const startIndex = records.findIndex(
      (record) => record.id === draggedId,
    );
    const targetIndex = records.findIndex(
      (record) => record.id === targetRecordId,
    );

    if (startIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }

    const rawInsertIndex = targetIndex + (placement === "after" ? 1 : 0);

    if (
      (placement === "before" && startIndex === targetIndex) ||
      (placement === "after" && startIndex === targetIndex + 1)
    ) {
      clearDragState();
      return;
    }

    const nextRecords = [...records];
    const [movedRecord] = nextRecords.splice(startIndex, 1);
    const insertIndex =
      startIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex;
    nextRecords.splice(insertIndex, 0, movedRecord);

    // Drops that land the row back where it started (the guard above only
    // catches immediate neighbours) must not persist a no-op.
    const unchanged = nextRecords.every(
      (record, index) => record.id === records[index].id,
    );

    clearDragState();

    if (unchanged) {
      return;
    }

    setError("");

    try {
      await onReorder(nextRecords.map((record) => record.id));
    } catch (reorderError) {
      setError(reorderError.message);
    }
  }

  // The trimmed draft, or null after reporting a missing name. Both commit
  // paths (a row edit and the add row) open with the same guard.
  function readDraftName() {
    const name = draftName.trim();

    if (!name) {
      setError("A name is required.");
      return null;
    }

    setError("");
    return name;
  }

  function beginEdit(record) {
    setEditingId(record.id);
    setDraftName(record.name);
    setError("");
  }

  // Cancel an edit. `refocus` is true for the deliberate paths (Escape, the
  // Cancel button, an unchanged name) where the row should get the cursor
  // back; it stays false when the edit is abandoned because focus left the
  // row, so a click elsewhere is not undone by a jump back to the row.
  function cancelEdit({ refocus = false } = {}) {
    const id = editingIdRef.current;
    setEditingId(null);
    setDraftName("");
    if (refocus) {
      setFocusRequest({ id });
    }
  }

  async function commitEdit(record) {
    const name = readDraftName();

    if (!name) {
      return;
    }

    if (name === record.name) {
      cancelEdit({ refocus: true });
      return;
    }

    setBusyId(record.id);

    try {
      await onUpdate(record.id, name);
      setEditingId(null);
      setDraftName("");
      setFocusRequest({ id: record.id });
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusyId(null);
    }
  }

  function beginAdd() {
    setIsAdding(true);
    setDraftName("");
    setError("");
  }

  function cancelAdd() {
    setIsAdding(false);
    setDraftName("");
    setFocusRequest({ add: true });
  }

  async function commitAdd() {
    const name = readDraftName();

    if (!name) {
      return;
    }

    setSaving(true);

    try {
      const created = await onCreate(name);
      setIsAdding(false);
      setDraftName("");
      setFocusRequest(created?.id != null ? { id: created.id } : { add: true });
    } catch (createError) {
      setError(createError.message);
    } finally {
      setSaving(false);
    }
  }

  async function requestDelete(record) {
    const confirmed = await confirm({
      title: `Delete "${record.name}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete",
    });

    if (!confirmed) {
      return;
    }

    const index = records.findIndex((entry) => entry.id === record.id);
    const neighbour =
      records[index + 1] ?? records[index - 1] ?? null;

    setBusyId(record.id);
    setError("");

    try {
      await onDelete(record.id);
      setFocusRequest(neighbour ? { id: neighbour.id } : { anchor: true });
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(record) {
    if (record.isDefault) {
      return;
    }

    setBusyId(record.id);
    setError("");

    try {
      await onSetDefault(record.id);
    } catch (defaultError) {
      setError(defaultError.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleRowKeyDown(event, record) {
    // Only the row itself edits. Tab can move focus onto a control inside the
    // row (star, rename, delete), and those must activate themselves instead
    // of the row swallowing Enter/Space as it bubbles up.
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      beginEdit(record);
    }
  }

  function handleEditKeyDown(event, record) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitEdit(record);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit({ refocus: true });
    }
  }

  function handleAddKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitAdd();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelAdd();
    }
  }

  // The banknote table's window-level key handling, scaled to a list that
  // never virtualizes. Editable fields keep their own keys; nested controls
  // hold focus so their Enter/Space wins; e/d only fire when the row itself
  // is the active element.
  useEffect(() => {
    function handleGlobalKeyDown(event) {
      if (confirmOpen) {
        return;
      }

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableElement(event.target)
      ) {
        return;
      }

      // Row focus only moves for the plain keys: a held Shift rests the
      // cursor where it is, matching the banknote table.
      if (!event.shiftKey && (event.key === "ArrowDown" || event.key === "j")) {
        event.preventDefault();
        moveFocus(1);
        return;
      }

      if (!event.shiftKey && (event.key === "ArrowUp" || event.key === "k")) {
        event.preventDefault();
        moveFocus(-1);
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        pageFocus(event.key === "PageDown" ? 1 : -1);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const record =
          event.key === "Home" ? records[0] : records[records.length - 1];

        if (record) {
          focusRow(record.id);
        }
        return;
      }

      if (event.key === "Escape") {
        const focusedElement =
          focusedIdRef.current == null
            ? null
            : rowRefs.current.get(focusedIdRef.current);

        if (focusedElement && document.activeElement === focusedElement) {
          event.preventDefault();
          anchorRef.current?.focus({ preventScroll: true });
          clearCursor();
        }
        return;
      }

      if (event.key === "a") {
        if (isAdding) {
          return;
        }

        event.preventDefault();
        beginAdd();
        return;
      }

      const focusedElement =
        focusedIdRef.current == null
          ? null
          : rowRefs.current.get(focusedIdRef.current);
      const rowHasFocus =
        Boolean(focusedElement) &&
        document.activeElement === focusedElement;

      if (!rowHasFocus) {
        return;
      }

      const record = records.find(
        (entry) => entry.id === focusedIdRef.current,
      );

      if (!record) {
        return;
      }

      if (event.key === "e") {
        event.preventDefault();
        beginEdit(record);
        return;
      }

      if (event.key === "d") {
        event.preventDefault();
        void requestDelete(record);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, records, isAdding]);

  return (
    <section className="named-records" aria-label={ariaLabel}>
      {dialog}
      <div className="named-records-toolbar">
        <button
          aria-label={`Add ${itemLabel}`}
          className="icon-link button-primary"
          data-shortcut="a"
          disabled={saving || Boolean(busyId) || confirmOpen || isAdding}
          onClick={beginAdd}
          ref={addButtonRef}
          type="button"
        >
          Add {itemLabel}
        </button>
        <p className="table-helper-text">
          Press <kbd>&uarr;</kbd>/<kbd>&darr;</kbd> to browse rows,{" "}
          <kbd>a</kbd> to add, or <kbd>e</kbd>/<kbd>d</kbd> to rename/delete a
          focused row.
        </p>
      </div>

      <div className="named-records-table-wrap" ref={tableWrapRef}>
        <span
          aria-hidden="true"
          className="table-focus-anchor"
          ref={anchorRef}
          tabIndex={-1}
        />
        <table className="named-records-table">
          <thead>
            <tr>
              {canReorder ? <th className="named-records-drag-cell" /> : null}
              <th scope="col">Name</th>
              {extraColumns.map((column) => (
                <th
                  className={column.className}
                  key={column.key}
                  scope="col"
                >
                  {column.header}
                </th>
              ))}
              <th scope="col">Default</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody
            onDragOver={(event) => {
              if (!canReorder || draggedId === null) {
                return;
              }

              event.preventDefault();
            }}
            onDrop={(event) => {
              // A row's own drop already handled (and default-prevented) this,
              // so only a drop on the placeholder reaches here.
              if (
                event.defaultPrevented ||
                !canReorder ||
                draggedId === null ||
                !dropTarget
              ) {
                return;
              }

              event.preventDefault();
              void handleReorder(dropTarget.recordId, dropTarget.placement);
            }}
          >
            {records.map((record) => {
              const isEditing = editingId === record.id;
              const isFocused = focusedId === record.id;
              const isBusy = busyId === record.id;
              const isDragging = draggedId === record.id;
              const showPlaceholderBefore =
                dropTarget?.recordId === record.id &&
                dropTarget.placement === "before";
              const showPlaceholderAfter =
                dropTarget?.recordId === record.id &&
                dropTarget.placement === "after";

              return (
                <Fragment key={record.id}>
                  {showPlaceholderBefore ? (
                    <tr
                      aria-hidden="true"
                      className="table-drop-placeholder-row"
                    >
                      <td
                        className="table-drop-placeholder-cell"
                        colSpan={totalColumnCount}
                      >
                        <span className="table-drop-placeholder-line" />
                      </td>
                    </tr>
                  ) : null}
                  <tr
                    className={`named-record-row${isFocused ? " named-record-row--focused" : ""}${isEditing ? " named-record-row--editing" : ""}${isDragging ? " named-record-row--dragging" : ""}`}
                    onBlur={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget)) {
                        return;
                      }

                      focusedIdRef.current =
                        focusedIdRef.current === record.id
                          ? null
                          : focusedIdRef.current;
                      setFocusedId((current) =>
                        current === record.id ? null : current,
                      );

                      if (editingIdRef.current === record.id) {
                        cancelEdit();
                      }
                    }}
                    onDragLeave={(event) => {
                      // The placeholder is a sibling row in this tbody, so
                      // moving onto it (or a neighbour) must not clear the
                      // target — that would unmount the placeholder and loop.
                      const body = event.currentTarget.closest("tbody");

                      if (
                        event.relatedTarget &&
                        body?.contains(event.relatedTarget)
                      ) {
                        return;
                      }

                      setDropTarget((current) =>
                        current?.recordId === record.id ? null : current,
                      );
                    }}
                    onDragOver={(event) => {
                      if (!canReorder || draggedId === null) {
                        return;
                      }

                      event.preventDefault();
                      updateDropTarget(record.id, event);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const nextPlacement =
                        dropTarget?.recordId === record.id
                          ? dropTarget.placement
                          : event.clientY < bounds.top + bounds.height / 2
                            ? "before"
                            : "after";
                      void handleReorder(record.id, nextPlacement);
                    }}
                    onFocus={() => {
                      focusedIdRef.current = record.id;

                      if (mouseFocusSuppressRef.current) {
                        mouseFocusSuppressRef.current = false;
                      } else {
                        setFocusedId(record.id);
                      }
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, record)}
                    onMouseDown={() => {
                      mouseFocusSuppressRef.current = true;
                    }}
                    onMouseUp={() => {
                      mouseFocusSuppressRef.current = false;
                    }}
                    ref={(element) => {
                      if (element) {
                        rowRefs.current.set(record.id, element);
                      } else {
                        rowRefs.current.delete(record.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    {canReorder ? (
                      <td className="named-records-drag-cell">
                        <button
                          aria-label={`Move ${record.name}`}
                          className="drag-handle"
                          draggable
                          onClick={(event) => event.stopPropagation()}
                          onDragEnd={clearDragState}
                          onDragStart={(event) => {
                            const row = rowRefs.current.get(record.id);

                            clearDragPreview();
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              String(record.id),
                            );

                            if (row) {
                              const preview = row.cloneNode(true);
                              preview.classList.add("table-drag-preview");
                              preview.style.width = `${row.getBoundingClientRect().width}px`;
                              document.body.appendChild(preview);
                              dragPreviewRef.current = preview;
                              event.dataTransfer.setDragImage(
                                preview,
                                24,
                                24,
                              );
                            }

                            setDraggedId(record.id);
                            setDropTarget({
                              recordId: record.id,
                              placement: "before",
                            });
                          }}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="drag-handle-dots"
                          >
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                          </span>
                        </button>
                      </td>
                    ) : null}
                    <td className="named-records-name-cell">
                    {isEditing ? (
                      <input
                        aria-label={`Rename ${record.name}`}
                        className="named-records-name-input"
                        disabled={isBusy}
                        onKeyDown={(event) =>
                          handleEditKeyDown(event, record)
                        }
                        onChange={(event) => setDraftName(event.target.value)}
                        value={draftName}
                      />
                    ) : (
                      record.name
                    )}
                  </td>
                  {extraColumns.map((column) => (
                    <td className={column.className} key={column.key}>
                      {column.render(record)}
                    </td>
                  ))}
                  <td className="named-records-default-cell">
                    <button
                      aria-label={
                        record.isDefault
                          ? `${record.name} is the default`
                          : `Mark ${record.name} as default`
                      }
                      aria-pressed={record.isDefault}
                      className={`named-record-star${record.isDefault ? " named-record-star--on" : ""}`}
                      disabled={record.isDefault || isBusy}
                      onClick={() => void setDefault(record)}
                      type="button"
                    >
                      {record.isDefault ? "★" : "☆"}
                    </button>
                  </td>
                  <td className="named-records-actions-cell">
                    {isEditing ? (
                      <div className="inline-actions">
                        <button
                          className="button button-primary"
                          disabled={isBusy}
                          onClick={() => void commitEdit(record)}
                          type="button"
                        >
                          Save
                        </button>
                        <button
                          className="button"
                          disabled={isBusy}
                          onClick={() => cancelEdit({ refocus: true })}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="inline-actions">
                        <button
                          aria-label={`Rename ${record.name}`}
                          className="icon-link"
                          data-shortcut="e"
                          disabled={isBusy}
                          onClick={() => beginEdit(record)}
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            height="16"
                            viewBox="0 0 24 24"
                            width="16"
                          >
                            <path
                              d="M4 20h4l10-10-4-4L4 16v4z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M12 6l4 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                          </svg>
                        </button>
                        <button
                          aria-label={`Delete ${record.name}`}
                          className="icon-link"
                          data-shortcut="d"
                          disabled={isBusy}
                          onClick={() => void requestDelete(record)}
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            height="16"
                            viewBox="0 0 24 24"
                            width="16"
                          >
                            <path
                              d="M5 7h14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M9 7V5h6v2"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                            <path
                              d="M8 7l1 12h6l1-12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            />
                          </svg>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                  {showPlaceholderAfter ? (
                    <tr
                      aria-hidden="true"
                      className="table-drop-placeholder-row"
                    >
                      <td
                        className="table-drop-placeholder-cell"
                        colSpan={totalColumnCount}
                      >
                        <span className="table-drop-placeholder-line" />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {isAdding ? (
              <tr className="named-record-row named-record-row--editing">
                {canReorder ? (
                  <td className="named-records-drag-cell" />
                ) : null}
                <td className="named-records-name-cell">
                  <input
                    aria-label={`New ${itemLabel} name`}
                    className="named-records-name-input"
                    disabled={saving}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={handleAddKeyDown}
                    placeholder={`New ${itemLabel} name`}
                    ref={addInputRef}
                    value={draftName}
                  />
                </td>
                {extraColumns.map((column) => (
                  <td className={column.className} key={column.key} />
                ))}
                <td className="named-records-default-cell" />
                <td className="named-records-actions-cell">
                  <div className="inline-actions">
                    <button
                      className="button button-primary"
                      disabled={saving}
                      onClick={() => void commitAdd()}
                      type="button"
                    >
                      Add
                    </button>
                    <button
                      className="button"
                      disabled={saving}
                      onClick={cancelAdd}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            ) : null}

            {!records.length && !isAdding && !loading ? (
              <tr className="named-records-empty-row">
                <td
                  className="named-records-empty-cell"
                  colSpan={totalColumnCount}
                >
                  {emptyText}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export { NamedRecordsTable };
