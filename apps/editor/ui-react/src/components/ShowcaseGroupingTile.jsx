import { ShowcaseCreateTile } from "./ShowcaseCreateTile.jsx";

// The edit-only `+ Add grouping` tile. A Grouping takes a name only; the
// parent is the node the canvas is currently drilled into, so the tile appears
// only below a Category or a Grouping, never at the top level.
function ShowcaseGroupingTile({ onAdd }) {
  return (
    <ShowcaseCreateTile
      addLabel="Add grouping"
      closedLabel="Add grouping"
      inputLabel="Grouping name"
      noun="grouping"
      onAdd={onAdd}
    />
  );
}

export { ShowcaseGroupingTile };
