// The edit-only `+ notes` tile. It is note-sized so it sits in the node's grid
// right after the notes; clicking it opens the picker for this node.
function ShowcaseNoteTile({ onClick }) {
  return (
    <button
      aria-label="Add notes"
      className="showcase-tile showcase-tile--note"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="showcase-tile-plus">
        +
      </span>
      Add notes
    </button>
  );
}

export { ShowcaseNoteTile };
