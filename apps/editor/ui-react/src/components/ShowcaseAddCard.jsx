import { ShowcaseGhostAdd } from "./ShowcaseGhostAdd.jsx";

// The one add action at the end of a level. It closes the grid as a slim bar
// rather than a card-sized empty tile: a giant placeholder looked like a
// missing specimen. The label names the things the collector adds, never the
// screen's internal "level".
function ShowcaseAddCard({ onAdd }) {
  return (
    <ShowcaseGhostAdd
      ariaLabel="Add a note or placeholder"
      hint="Groupings too"
      label="Add a note or placeholder"
      onClick={onAdd}
    />
  );
}

export { ShowcaseAddCard };
