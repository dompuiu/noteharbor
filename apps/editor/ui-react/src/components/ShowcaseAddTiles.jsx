// The one `+ Add` block at the end of a level. It opens the merged add dialog
// (notes or catalog shell); grouping creation lives in the same dialog's item
// menus, so the canvas no longer needs a stack of edit-only tiles.
function ShowcaseAddTiles({ onClick }) {
  return (
    <button
      aria-label="Add to this level"
      className="showcase-tile showcase-tile--add"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="showcase-tile-plus">
        +
      </span>
      Add
    </button>
  );
}

export { ShowcaseAddTiles };
