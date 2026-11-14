// The edit-only `+ catalog entry` tile. It sits in the add block between Add
// notes and Add grouping; clicking it opens the small add-entry form for the
// current level.
function ShowcaseCatalogEntryTile({ onClick, parentId }) {
  return (
    <button
      aria-label="Add catalog entry"
      className="showcase-tile"
      data-showcase-add-parent={parentId}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="showcase-tile-plus">
        +
      </span>
      Add catalog entry
    </button>
  );
}

export { ShowcaseCatalogEntryTile };
