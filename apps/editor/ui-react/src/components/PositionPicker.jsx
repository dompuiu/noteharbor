import { useEffect, useMemo, useRef, useState } from "react";

function pickFrontThumbnail(images) {
  return (
    images.find((img) => img.type === "front" && img.variant === "thumbnail") ??
    images.find((img) => img.type === "front" && img.variant === "full") ??
    null
  );
}

function PositionPicker({ notes, onSelect, selectedId }) {
  const [filter, setFilter] = useState("");
  const listRef = useRef(null);
  const selectedButtonRef = useRef(null);
  const hasAutoScrolledRef = useRef(false);

  const filteredNotes = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter((note) => {
      const denom = (note.denomination ?? "").toLowerCase();
      const catalog = (note.catalog_number ?? "").toLowerCase();
      return denom.includes(term) || catalog.includes(term);
    });
  }, [notes, filter]);

  useEffect(() => {
    const listElement = listRef.current;
    const selectedElement = selectedButtonRef.current;

    if (hasAutoScrolledRef.current || !selectedId || !listElement || !selectedElement) {
      return;
    }

    const listRect = listElement.getBoundingClientRect();
    const selectedRect = selectedElement.getBoundingClientRect();

    if (selectedRect.top < listRect.top) {
      listElement.scrollTop -= listRect.top - selectedRect.top;
    } else if (selectedRect.bottom > listRect.bottom) {
      listElement.scrollTop += selectedRect.bottom - listRect.bottom;
    }

    hasAutoScrolledRef.current = true;
  }, [selectedId]);

  return (
    <div className="position-picker">
      <input
        className="filter-input"
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter by denomination or catalog number"
        type="text"
        value={filter}
      />
      <div className="position-picker-list" ref={listRef}>
        {filteredNotes.length === 0 ? (
          <p className="muted position-picker-empty">No notes match.</p>
        ) : (
          filteredNotes.map((note) => {
            const thumb = pickFrontThumbnail(note.images ?? []);
            const isSelected = note.id === selectedId;
            return (
              <button
                className={`position-picker-item${isSelected ? " is-selected" : ""}`}
                key={note.id}
                onClick={() => onSelect(note.id)}
                ref={isSelected ? selectedButtonRef : null}
                type="button"
              >
                <div className="position-picker-thumb">
                  {thumb ? (
                    <img alt="" src={thumb.localPath} />
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </div>
                <div className="position-picker-label">
                  <span className="position-picker-title">
                    {note.denomination || <span className="muted">No denomination</span>}
                  </span>
                  <span className="position-picker-subtitle">
                    {[note.catalog_number, note.grade].filter(Boolean).join(" · ") || <span className="muted">—</span>}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export { PositionPicker };
