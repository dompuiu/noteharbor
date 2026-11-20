// The free-text the collector wrote on the card. One block serves both leaves:
// a note reads its record's notes, a placeholder reads its own reminder. The
// Library label keeps two lines under the metadata; the Auction rail gives four
// lines in the identity column, pinned by a margin rule. A card without notes
// renders nothing, keeping quiet cards quiet. The clamped text keeps the full
// string in `title`, so the pointer never loses the rest.
function ShowcaseCardNotes({ id, layout = "labels", text }) {
  if (!text) {
    return null;
  }

  return (
    <span
      className={`showcase-card-notes showcase-card-notes--${layout}`}
      id={id}
      title={text}
    >
      <span className="showcase-card-notes-label">Note</span>
      <span className="showcase-card-notes-text">{text}</span>
    </span>
  );
}

export { ShowcaseCardNotes };
