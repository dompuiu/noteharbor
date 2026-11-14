// The edit-only `+ notes` tile. It sits first in `.showcase-add-tiles`, the
// stacked add block inside one note-sized grid cell; clicking it opens the
// picker for this node.
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
