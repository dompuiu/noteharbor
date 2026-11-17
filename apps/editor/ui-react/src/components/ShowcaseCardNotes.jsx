// The record's free-text notes, read on the card. The Library label keeps two
// lines under the metadata; the Auction rail gives the notes four lines beside
// the scan, pinned by a margin rule so the annotation reads as part of the
// identity column. A note without notes renders nothing, keeping quiet cards
// quiet.
function ShowcaseCardNotes({ id, layout = "labels", text }) {
  if (!text) {
    return null;
  }

  return (
    <span
      className={`showcase-card-notes showcase-card-notes--${layout}`}
      id={id}
    >
      <span className="showcase-card-notes-label">Notes</span>
      <span className="showcase-card-notes-text">{text}</span>
    </span>
  );
}

export { ShowcaseCardNotes };
