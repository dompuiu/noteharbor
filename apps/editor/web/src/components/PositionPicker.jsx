import { useMemo, useState } from "react";

function pickFrontThumbnail(images) {
  return (
    images.find((img) => img.type === "front" && img.variant === "thumbnail") ??
    images.find((img) => img.type === "front" && img.variant === "full") ??
    null
  );
}

function PositionPicker({ notes, onSelect, selectedId }) {
  const [filter, setFilter] = useState("");

  const filteredNotes = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return notes;
    return notes.filter((note) => {
      const denom = (note.denomination ?? "").toLowerCase();
      const catalog = (note.catalog_number ?? "").toLowerCase();
      return denom.includes(term) || catalog.includes(term);
    });
  }, [notes, filter]);

  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <input
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter by denomination or catalog number"
        style={{
          padding: "6px 10px",
          borderRadius: "8px",
          border: "1px solid rgba(92, 59, 24, 0.2)",
          background: "rgba(255, 248, 239, 0.8)",
          width: "100%",
          boxSizing: "border-box",
        }}
        type="text"
        value={filter}
      />
      <div
        style={{
          maxHeight: "280px",
          overflowY: "auto",
          display: "grid",
          gap: "6px",
          padding: "2px",
        }}
      >
        {filteredNotes.length === 0 ? (
          <p className="muted" style={{ margin: "8px 0" }}>
            No notes match.
          </p>
        ) : (
          filteredNotes.map((note) => {
            const thumb = pickFrontThumbnail(note.images ?? []);
            const isSelected = note.id === selectedId;
            return (
              <button
                key={note.id}
                onClick={() => onSelect(note.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  border: isSelected
                    ? "1.5px solid rgba(111, 66, 31, 0.6)"
                    : "1px solid rgba(92, 59, 24, 0.14)",
                  background: isSelected
                    ? "rgba(111, 66, 31, 0.08)"
                    : "rgba(255, 255, 255, 0.56)",
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                  width: "100%",
                }}
                type="button"
              >
                <div
                  style={{
                    width: "48px",
                    height: "32px",
                    flexShrink: 0,
                    borderRadius: "6px",
                    overflow: "hidden",
                    background: "rgba(92, 59, 24, 0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {thumb ? (
                    <img
                      alt=""
                      src={thumb.localPath}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: "0.6rem", color: "#8b7b68" }}>—</span>
                  )}
                </div>
                <div style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: "0.88rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {note.denomination || <span className="muted">No denomination</span>}
                  </span>
                  <span style={{ fontSize: "0.78rem", color: "#8b7b68" }}>
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
