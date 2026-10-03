import { useEffect, useRef, useState } from "react";
import { useConfirmation } from "./ConfirmDialog.jsx";

// A table of named records: one row per record, a name field, and a default
// flag. Each row carries a selection checkbox, a default star, and rename /
// delete actions. The component owns row selection, the keyboard cursor, and
// in-place editing, and reports every change through callbacks so the caller
// keeps owning the record list. It is deliberately free of any domain
// coupling — Categories and Groupings can pass their own records and verbs.
function NamedRecordsTable({
  ariaLabel = "Named records",
  emptyText = "No records yet.",
  itemLabel = "record",
  itemLabelPlural = "records",
  loading = false,
  onCreate,
  onDelete,
  onSetDefault,
  onUpdate,
  records,
}) {
  const anchorRef = useRef(null);
  const addButtonRef = useRef(null);
  const addInputRef = useRef(null);
  const rowRefs = useRef(new Map());
  const selectAllRef = useRef(null);

  const [selectedIds, setSelectedIds] = useState([]);
  const [focusedId, setFocusedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { confirm, dialog, isOpen: confirmOpen } = useConfirmation();
  // A focus intent that has to wait for `records` to reflect the change that
  // produced it (a created row, a deleted row's neighbour). A missing row
  // means "not yet", not "give up", so the request survives until it lands.
  const [focusRequest, setFocusRequest] = useState(null);
  // The id of the row being edited, reachable from handlers without rebuilding
  // their closures on every keystroke.
  const editingIdRef = useRef(null);
  editingIdRef.current = editingId;

  const selectedIdSet = new Set(selectedIds);
  const selectedCount = records.reduce(
    (count, record) => (selectedIdSet.has(record.id) ? count + 1 : count),
    0,
  );
  const allSelected = records.length > 0 && selectedCount === records.length;
  const someSelected = selectedCount > 0 && !allSelected;

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => records.some((record) => record.id === id)),
    );
  }, [records]);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

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

  function focusRow(id) {
    const element = rowRefs.current.get(id);

    if (element) {
      element.focus();
      setFocusedId(id);
    }
  }

  function moveFocus(offset) {
    if (!records.length) {
      return;
    }

    const currentIndex = records.findIndex(
      (record) => record.id === focusedId,
    );
    const baseIndex = currentIndex >= 0 ? currentIndex : offset > 0 ? -1 : 0;
    const nextIndex = Math.min(
      Math.max(baseIndex + offset, 0),
      records.length - 1,
    );

    focusRow(records[nextIndex].id);
  }

  function toggleSelected(id) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function toggleAllSelected() {
    setSelectedIds(allSelected ? [] : records.map((record) => record.id));
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
      setSelectedIds((current) =>
        current.filter((id) => id !== record.id),
      );
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
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      moveFocus(1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      moveFocus(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      beginEdit(record);
      return;
    }

    if (event.key === "Escape" && editingIdRef.current === record.id) {
      event.preventDefault();
      cancelEdit({ refocus: true });
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

  return (
    <section className="named-records" aria-label={ariaLabel}>
      {dialog}
      <div className="named-records-toolbar">
        <button
          className="button button-primary"
          disabled={saving || Boolean(busyId) || confirmOpen || isAdding}
          onClick={beginAdd}
          ref={addButtonRef}
          type="button"
        >
          Add {itemLabel}
        </button>
        <span aria-live="polite" className="muted">
          {selectedCount} of {records.length} selected
        </span>
      </div>

      <div className="named-records-table-wrap">
        <span
          aria-hidden="true"
          className="table-focus-anchor"
          ref={anchorRef}
          tabIndex={-1}
        />
        <table className="named-records-table">
          <thead>
            <tr>
              <th className="named-records-select-cell" scope="col">
                <input
                  aria-label={`Select all ${itemLabelPlural}`}
                  checked={allSelected}
                  onChange={toggleAllSelected}
                  ref={selectAllRef}
                  type="checkbox"
                />
              </th>
              <th scope="col">Name</th>
              <th scope="col">Default</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const isEditing = editingId === record.id;
              const isFocused = focusedId === record.id;
              const isBusy = busyId === record.id;

              return (
                <tr
                  className={`named-record-row${isFocused ? " named-record-row--focused" : ""}${isEditing ? " named-record-row--editing" : ""}`}
                  key={record.id}
                  onBlur={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget)) {
                      return;
                    }

                    setFocusedId((current) =>
                      current === record.id ? null : current,
                    );

                    if (editingIdRef.current === record.id) {
                      cancelEdit();
                    }
                  }}
                  onFocus={() => setFocusedId(record.id)}
                  onKeyDown={(event) => handleRowKeyDown(event, record)}
                  ref={(element) => {
                    if (element) {
                      rowRefs.current.set(record.id, element);
                    } else {
                      rowRefs.current.delete(record.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <td className="named-records-select-cell">
                    <input
                      aria-label={`Select ${record.name}`}
                      checked={selectedIdSet.has(record.id)}
                      onChange={() => toggleSelected(record.id)}
                      type="checkbox"
                    />
                  </td>
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
                      <>
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
                      </>
                    ) : (
                      <>
                        <button
                          aria-label={`Rename ${record.name}`}
                          className="button"
                          disabled={isBusy}
                          onClick={() => beginEdit(record)}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          aria-label={`Delete ${record.name}`}
                          className="button button-danger-soft"
                          disabled={isBusy}
                          onClick={() => void requestDelete(record)}
                          type="button"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}

            {isAdding ? (
              <tr className="named-record-row named-record-row--editing">
                <td className="named-records-select-cell" />
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
                <td className="named-records-default-cell" />
                <td className="named-records-actions-cell">
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
                </td>
              </tr>
            ) : null}

            {!records.length && !isAdding && !loading ? (
              <tr className="named-records-empty-row">
                <td className="named-records-empty-cell" colSpan={4}>
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
