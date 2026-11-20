// A placeholder's own reminder, read on an unseen card and in the form's
// preview. It is not the specimen notes block: a small Note title, muted text,
// two lines, and the full text in the title. A placeholder without notes
// renders nothing.
function ShowcaseCatalogNotes({ text }) {
  if (!text) {
    return null;
  }

  return (
    <span className="showcase-catalog-notes" title={text}>
      <span className="showcase-catalog-notes-label">Note</span>
      <span className="showcase-catalog-notes-text">{text}</span>
    </span>
  );
}

export { ShowcaseCatalogNotes };
