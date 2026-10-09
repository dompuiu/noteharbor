import { ShowcaseGroupingTile } from "./ShowcaseGroupingTile.jsx";
import { ShowcaseNoteTile } from "./ShowcaseNoteTile.jsx";

// The edit-only `+` actions for one grid level. The two tiles stack vertically
// inside a single grid cell so `+ Add notes` never stretches beside a note
// while `+ Add grouping` sits small on the next row. The container fills its
// grid cell and keeps a note-sized minimum height, so it reads as one note
// even when it wraps onto its own row.
function ShowcaseAddTiles({ onAddNotes, onAddGrouping }) {
  return (
    <div className="showcase-add-tiles">
      <ShowcaseNoteTile onClick={onAddNotes} />
      <ShowcaseGroupingTile onAdd={onAddGrouping} />
    </div>
  );
}

export { ShowcaseAddTiles };
