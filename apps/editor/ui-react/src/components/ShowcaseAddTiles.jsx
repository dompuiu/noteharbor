import { ShowcaseCatalogEntryTile } from "./ShowcaseCatalogEntryTile.jsx";
import { ShowcaseGroupingTile } from "./ShowcaseGroupingTile.jsx";
import { ShowcaseNoteTile } from "./ShowcaseNoteTile.jsx";

// The edit-only `+` actions for one grid level, stacked inside a single grid
// cell so they read as one add block: Add notes, Add catalog entry, Add
// grouping. The container fills its cell and keeps a note-sized minimum height,
// so the block never stretches the row.
function ShowcaseAddTiles({
  catalogParentId,
  onAddCatalogEntry,
  onAddNotes,
  onAddGrouping,
}) {
  return (
    <div className="showcase-add-tiles">
      <ShowcaseNoteTile onClick={onAddNotes} />
      <ShowcaseCatalogEntryTile
        onClick={onAddCatalogEntry}
        parentId={catalogParentId}
      />
      <ShowcaseGroupingTile onAdd={onAddGrouping} />
    </div>
  );
}

export { ShowcaseAddTiles };
